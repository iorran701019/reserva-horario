// Reprocessa as fotos já existentes nos buckets 'fotos-categorias' e
// 'fotos-perfil' (JPEG qualidade 80, lado maior 1600 categoria / 800 perfil,
// fundo branco, rotação EXIF respeitada): mesma lógica de prepararFotoParaUpload
// em lib/comprimirImagem.js, só que em Node com sharp.
//
// Uso (PowerShell, na raiz do repo):
//   node scripts/reprocessar-fotos-storage.mjs --env-file .env.local --ambiente staging
//   node scripts/reprocessar-fotos-storage.mjs --env-file .env.local --ambiente staging --apply --backup-dir C:\backup-fotos
//   node scripts/reprocessar-fotos-storage.mjs --env-file .env.local --ambiente staging --remover-antigos --backup-dir C:\backup-fotos [--apply]
//   Produção: acrescentar --ambiente prod --confirmar-prod.
//
// Sem --apply é dry-run: só list + metadados, não baixa nem grava nada. O
// .env.local aponta pra UM projeto; o host dele é mostrado antes de qualquer
// escrita e precisa ser digitado pra confirmar. A chave de serviço nunca é
// impressa.
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  ALVOS,
  CACHE_CONTROL,
  QUALIDADE_JPEG,
  antigosRemoviveis,
  caminhoBackup,
  caminhoDaUrl,
  caminhoDestino,
  decidirAcao,
  deveGravar,
  estaDentro,
  formatarMB,
  hostDaUrl,
  jpgPequenoPodePular,
  lerArgs,
  validarArgs,
} from "./fotosStorage.mjs";

const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function falhar(msg) {
  console.error(`ERRO: ${msg}`);
  process.exit(1);
}

async function carregarSharp() {
  try {
    return (await import("sharp")).default;
  } catch (e) {
    falhar(
      "não foi possível carregar o sharp (" +
        (e?.message || e) +
        "). Rode 'npm install' na raiz do repo; se persistir, 'npm i -D sharp' " +
        "(o binário da plataforma precisa estar instalado)."
    );
  }
}

async function confirmarHost(host, ambiente, acao) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const resp = await rl.question(
    `Vai ${acao} em ${host} (ambiente ${ambiente}). Digite o host para continuar: `
  );
  rl.close();
  if (resp.trim() !== host) falhar("host digitado não confere; nada foi feito.");
}

// Lista todos os objetos do bucket (pastas = estabelecimento_id).
async function listarPasta(supabase, bucket, pasta) {
  const itens = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(pasta, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list ${bucket}/${pasta}: ${error.message}`);
    itens.push(...data);
    if (data.length < 100) break;
  }
  return itens;
}

async function listarBucket(supabase, bucket) {
  const objetos = new Map(); // caminho -> { tamanho, mime }
  const raiz = await listarPasta(supabase, bucket, "");
  for (const item of raiz) {
    if (item.id === null) {
      for (const f of await listarPasta(supabase, bucket, item.name)) {
        if (f.id === null) continue;
        objetos.set(`${item.name}/${f.name}`, {
          tamanho: f.metadata?.size,
          mime: f.metadata?.mimetype,
        });
      }
    } else {
      objetos.set(item.name, { tamanho: item.metadata?.size, mime: item.metadata?.mimetype });
    }
  }
  return objetos;
}

async function lerLinhas(supabase, alvo) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from(alvo.tabela)
      .select(`id, ${alvo.coluna}`)
      .not(alvo.coluna, "is", null)
      .order("id")
      .range(de, de + 999);
    if (error) throw new Error(`select ${alvo.tabela}: ${error.message}`);
    linhas.push(...data.map((l) => ({ id: l.id, url: l[alvo.coluna] })));
    if (data.length < 1000) break;
  }
  return linhas;
}

// Cruza linhas do banco com os objetos do bucket.
function cruzar(alvo, objetos, linhas) {
  const porCaminho = new Map(); // caminho -> linhas[]
  const semArquivo = [];
  for (const l of linhas) {
    const caminho = caminhoDaUrl(l.url, alvo.bucket);
    if (!caminho || !objetos.has(caminho)) {
      semArquivo.push({ ...l, caminho });
      continue;
    }
    if (!porCaminho.has(caminho)) porCaminho.set(caminho, []);
    porCaminho.get(caminho).push(l);
  }
  const orfaos = [...objetos.keys()].filter((c) => !porCaminho.has(c));
  return { porCaminho, semArquivo, orfaos };
}

async function processarComSharp(sharp, buffer, ladoMax) {
  // rotate() antes do resize: o lado maior vale pra imagem já na orientação
  // final. fit "inside" + withoutEnlargement mantêm a proporção (só arredonda
  // pro pixel inteiro) e nunca ampliam, então foto_posicao (%) e foto_zoom
  // (multiplicador sobre a escala de cobertura) continuam válidos.
  return sharp(buffer, { failOn: "error" })
    .rotate()
    .resize({ width: ladoMax, height: ladoMax, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: QUALIDADE_JPEG, mozjpeg: true })
    .toBuffer();
}

async function gravarBackup(supabase, bucket, caminho, dir, ambiente, bufferJaBaixado) {
  const destino = caminhoBackup(dir, ambiente, bucket, caminho);
  let buffer = bufferJaBaixado;
  if (!buffer) {
    const { data, error } = await supabase.storage.from(bucket).download(caminho);
    if (error) throw new Error(`backup download ${caminho}: ${error.message}`);
    buffer = Buffer.from(await data.arrayBuffer());
  }
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, buffer);
  const st = await fs.stat(destino);
  if (st.size !== buffer.length) throw new Error(`backup de ${caminho} com tamanho divergente`);
}

async function conferirNoBucket(supabase, bucket, caminho, tamanhoEsperado) {
  const i = caminho.lastIndexOf("/");
  const pasta = i === -1 ? "" : caminho.slice(0, i);
  const nome = caminho.slice(i + 1);
  const { data, error } = await supabase.storage.from(bucket).list(pasta, { search: nome, limit: 100 });
  if (error) return false;
  const achado = data.find((f) => f.name === nome);
  return !!achado && achado.metadata?.size === tamanhoEsperado;
}

function imprimirRelatorioInconsistencias(alvo, { semArquivo, orfaos }) {
  if (semArquivo.length) {
    console.log(`  Linhas sem arquivo (${alvo.tabela}.${alvo.coluna}) — não tocadas:`);
    for (const l of semArquivo) console.log(`    id ${l.id}: ${l.caminho ?? "(URL fora deste bucket)"}`);
  }
  if (orfaos.length) {
    console.log(`  Objetos sem linha apontando (órfãos) — não tocados:`);
    for (const c of orfaos) console.log(`    ${c}`);
  }
}

async function modoReprocessar({ supabase, args, ambiente, host }) {
  const apply = !!args.apply;
  const sharp = apply ? await carregarSharp() : null;
  const resumo = { antes: 0, depois: 0, gravados: 0, pulados: 0, falhas: 0 };
  const antigosPendentes = [];

  for (const alvo of ALVOS) {
    console.log(`\n== ${alvo.bucket} (lado máx ${alvo.lado}px) ==`);
    const objetos = await listarBucket(supabase, alvo.bucket);
    const linhas = await lerLinhas(supabase, alvo);
    const cruz = cruzar(alvo, objetos, linhas);
    console.log(`  ${objetos.size} objetos, ${linhas.length} linhas com URL.`);

    for (const [caminho, rows] of cruz.porCaminho) {
      const info = objetos.get(caminho);
      const destino = caminhoDestino(caminho);
      const decisao = decidirAcao({ caminho, tamanho: info.tamanho });
      const tam = Number.isFinite(info.tamanho) ? formatarMB(info.tamanho) : "?";
      const rotulo = `${alvo.bucket}/${caminho} [${tam}]`;
      const ids = rows.map((r) => r.id).join(",");

      if (!apply) {
        if (decisao.acao === "pular") {
          console.log(`  PULAR       ${rotulo} — ${decisao.motivo}`);
        } else {
          console.log(
            `  REPROCESSAR ${rotulo} -> ${destino}; ${alvo.tabela}.${alvo.coluna} (id ${ids}) ganharia nova URL com ?v=; tamanho depois: só no --apply`
          );
        }
        continue;
      }

      if (decisao.acao === "pular" && decisao.motivo.startsWith("heic")) {
        console.log(`  PULAR       ${rotulo} — ${decisao.motivo}`);
        resumo.pulados++;
        continue;
      }

      try {
        const { data, error } = await supabase.storage.from(alvo.bucket).download(caminho);
        if (error) throw new Error(`download: ${error.message}`);
        const original = Buffer.from(await data.arrayBuffer());

        if (decisao.acao === "pular") {
          const meta = await sharp(original, { failOn: "error" }).metadata();
          if (
            jpgPequenoPodePular({
              caminho,
              tamanho: original.length,
              largura: meta.width,
              altura: meta.height,
              ladoMax: alvo.lado,
            })
          ) {
            console.log(`  PULAR       ${rotulo} — jpg pequeno e dentro do lado`);
            resumo.pulados++;
            continue;
          }
        }

        const novo = await processarComSharp(sharp, original, alvo.lado);
        if (!deveGravar(novo.length, original.length)) {
          console.log(`  PULAR       ${rotulo} — novo (${formatarMB(novo.length)}) não é pelo menos 10% menor`);
          resumo.pulados++;
          continue;
        }

        // Backup do original (e do destino, se for outro arquivo já existente)
        // ANTES de qualquer escrita.
        await gravarBackup(supabase, alvo.bucket, caminho, args["backup-dir"], ambiente, original);
        if (destino !== caminho && objetos.has(destino)) {
          await gravarBackup(supabase, alvo.bucket, destino, args["backup-dir"], ambiente, null);
        }

        const { error: erroUp } = await supabase.storage.from(alvo.bucket).upload(destino, novo, {
          upsert: true,
          contentType: "image/jpeg",
          cacheControl: CACHE_CONTROL,
        });
        if (erroUp) throw new Error(`upload: ${erroUp.message}`);

        if (!(await conferirNoBucket(supabase, alvo.bucket, destino, novo.length))) {
          throw new Error("arquivo novo não confere no bucket; coluna NÃO atualizada");
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from(alvo.bucket).getPublicUrl(destino);
        const urlNova = `${publicUrl}?v=${Date.now()}`;

        for (const r of rows) {
          if (r.url === urlNova) throw new Error("?v= não mudou");
          const { data: lin, error: erroUpd } = await supabase
            .from(alvo.tabela)
            .update({ [alvo.coluna]: urlNova })
            .eq("id", r.id)
            .eq(alvo.coluna, r.url)
            .select("id");
          if (erroUpd) throw new Error(`update id ${r.id}: ${erroUpd.message}`);
          if (!lin?.length) {
            throw new Error(
              `linha id ${r.id} mudou durante a execução; coluna NÃO atualizada (arquivo novo já está no bucket, backup guardado)`
            );
          }
        }

        resumo.antes += original.length;
        resumo.depois += novo.length;
        resumo.gravados++;
        if (destino !== caminho) antigosPendentes.push(`${alvo.bucket}/${caminho}`);
        console.log(
          `  OK          ${rotulo} -> ${destino} [${formatarMB(novo.length)}]`
        );
      } catch (e) {
        resumo.falhas++;
        console.log(`  FALHA       ${rotulo} — ${e.message}`);
      }
    }
    imprimirRelatorioInconsistencias(alvo, cruz);
  }

  if (!apply) {
    console.log("\nDry-run: nada foi baixado, gravado nem alterado. Use --apply para executar.");
    return;
  }
  console.log("\n== Resumo ==");
  console.log(`  Gravados: ${resumo.gravados} | pulados: ${resumo.pulados} | falhas: ${resumo.falhas}`);
  console.log(
    `  Antes: ${formatarMB(resumo.antes)} | depois: ${formatarMB(resumo.depois)} | economizados: ${formatarMB(resumo.antes - resumo.depois)}`
  );
  if (antigosPendentes.length) {
    console.log("  Arquivos antigos (caminho diferente) mantidos; remova depois com --remover-antigos:");
    for (const a of antigosPendentes) console.log(`    ${a}`);
  }
  console.log(`  Backup em ${path.resolve(args["backup-dir"], ambiente)} (host ${host})`);
  if (resumo.falhas) process.exitCode = 1;
}

async function modoRemoverAntigos({ supabase, args, ambiente }) {
  const apply = !!args.apply;
  let removidos = 0;
  for (const alvo of ALVOS) {
    console.log(`\n== ${alvo.bucket} ==`);
    const objetos = await listarBucket(supabase, alvo.bucket);
    const linhas = await lerLinhas(supabase, alvo);
    const referenciados = new Set(
      linhas.map((l) => caminhoDaUrl(l.url, alvo.bucket)).filter(Boolean)
    );
    const candidatos = antigosRemoviveis([...objetos.keys()], referenciados);
    const seguros = [];
    for (const c of candidatos) {
      try {
        await fs.stat(caminhoBackup(args["backup-dir"], ambiente, alvo.bucket, c));
        seguros.push(c);
      } catch {
        console.log(`  MANTIDO     ${c} — sem backup em --backup-dir`);
      }
    }
    for (const c of seguros) console.log(`  ${apply ? "REMOVER" : "REMOVERIA"}    ${alvo.bucket}/${c}`);
    if (apply && seguros.length) {
      const { error } = await supabase.storage.from(alvo.bucket).remove(seguros);
      if (error) {
        console.log(`  FALHA ao remover: ${error.message}`);
        process.exitCode = 1;
      } else {
        removidos += seguros.length;
      }
    }
  }
  console.log(
    apply ? `\nRemovidos: ${removidos}.` : "\nDry-run: nada removido. Use --apply para remover."
  );
}

async function main() {
  let args;
  try {
    args = lerArgs(process.argv.slice(2));
  } catch (e) {
    falhar(e.message);
  }
  const erroArgs = validarArgs(args);
  if (erroArgs) falhar(erroArgs);

  if (args["backup-dir"] && estaDentro(RAIZ_REPO, args["backup-dir"])) {
    falhar("--backup-dir precisa ficar FORA do repositório.");
  }

  try {
    process.loadEnvFile(args["env-file"]);
  } catch (e) {
    falhar(`não foi possível ler ${args["env-file"]}: ${e.message}`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const host = hostDaUrl(url);
  if (!host || !chave) {
    falhar("NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar no --env-file.");
  }
  console.log(`Projeto: ${host} | ambiente declarado: ${args.ambiente}`);

  const supabase = createClient(url, chave, { auth: { persistSession: false } });
  const ctx = { supabase, args, ambiente: args.ambiente, host };

  if (args["remover-antigos"]) {
    if (args.apply) await confirmarHost(host, args.ambiente, "REMOVER arquivos antigos");
    await modoRemoverAntigos(ctx);
  } else {
    if (args.apply) await confirmarHost(host, args.ambiente, "REPROCESSAR fotos (grava no bucket e no banco)");
    await modoReprocessar(ctx);
  }
}

main().catch((e) => falhar(e?.message || String(e)));
