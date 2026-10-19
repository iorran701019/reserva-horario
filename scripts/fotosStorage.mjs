// Funções puras do script reprocessar-fotos-storage.mjs (sem rede, sem sharp,
// sem disco), separadas só pra poderem ser testadas em tests/.
import path from "node:path";

export const ALVOS = [
  { bucket: "fotos-categorias", tabela: "categorias_servico", coluna: "foto_url", lado: 1600 },
  { bucket: "fotos-perfil", tabela: "estabelecimentos", coluna: "foto_perfil_url", lado: 800 },
];

export const QUALIDADE_JPEG = 80;
export const CACHE_CONTROL = "31536000";
export const LIMITE_JPEG_PEQUENO = 400 * 1024;

export function extensao(caminho) {
  const m = /\.([^./]+)$/.exec(caminho || "");
  return m ? m[1].toLowerCase() : "";
}

export function semExtensao(caminho) {
  return (caminho || "").replace(/\.[^./]+$/, "");
}

export function caminhoDestino(caminho) {
  return `${semExtensao(caminho)}.jpg`;
}

// Caminho do objeto dentro do bucket, a partir da URL pública salva (com ?v=).
// Devolve null se a URL não é deste bucket.
export function caminhoDaUrl(url, bucket) {
  if (!url || typeof url !== "string") return null;
  const marcador = `/${bucket}/`;
  const semQuery = url.split("?")[0].split("#")[0];
  const i = semQuery.indexOf(marcador);
  if (i === -1) return null;
  try {
    return decodeURIComponent(semQuery.slice(i + marcador.length)) || null;
  } catch {
    return null;
  }
}

// Decisão sem baixar nada (só nome e tamanho do list). O lado do .jpg pequeno
// só é conferido no --apply, quando o arquivo é baixado.
export function decidirAcao({ caminho, tamanho }) {
  const ext = extensao(caminho);
  if (ext === "heic" || ext === "heif") {
    return { acao: "pular", motivo: "heic: sharp sem HEVC, converter à parte" };
  }
  if ((ext === "jpg" || ext === "jpeg") && Number.isFinite(tamanho) && tamanho <= LIMITE_JPEG_PEQUENO) {
    return { acao: "pular", motivo: "jpg já pequeno (lado conferido só no --apply)" };
  }
  return { acao: "reprocessar", motivo: "" };
}

// No --apply, .jpg pequeno só é pulado de vez se o lado também couber.
export function jpgPequenoPodePular({ caminho, tamanho, largura, altura, ladoMax }) {
  const ext = extensao(caminho);
  if (ext !== "jpg" && ext !== "jpeg") return false;
  if (!(tamanho <= LIMITE_JPEG_PEQUENO)) return false;
  return Math.max(largura || 0, altura || 0) <= ladoMax;
}

// Só grava se o novo for pelo menos 10% menor que o original.
export function deveGravar(tamanhoNovo, tamanhoOriginal) {
  return tamanhoNovo < tamanhoOriginal * 0.9;
}

// Antigos removíveis: objetos que nenhuma linha referencia, não são .jpg e
// têm um irmão .jpg (mesma pasta e nome-base) que alguma linha referencia.
export function antigosRemoviveis(objetos, referenciados) {
  const refs = referenciados instanceof Set ? referenciados : new Set(referenciados);
  return objetos.filter((caminho) => {
    if (refs.has(caminho)) return false;
    if (extensao(caminho) === "jpg") return false;
    return refs.has(caminhoDestino(caminho));
  });
}

export function caminhoBackup(dir, ambiente, bucket, caminho) {
  const base = path.resolve(dir, ambiente, bucket);
  const alvo = path.resolve(base, ...caminho.split("/"));
  const rel = path.relative(base, alvo);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Caminho de backup inválido: ${caminho}`);
  }
  return alvo;
}

export function estaDentro(pai, filho) {
  const rel = path.relative(path.resolve(pai), path.resolve(filho));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function formatarMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function hostDaUrl(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const FLAGS_BOOLEANOS = new Set(["apply", "confirmar-prod", "remover-antigos"]);
const FLAGS_COM_VALOR = new Set(["env-file", "ambiente", "backup-dir"]);

export function lerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`Argumento inesperado: ${a}`);
    const nome = a.slice(2);
    if (FLAGS_BOOLEANOS.has(nome)) {
      args[nome] = true;
    } else if (FLAGS_COM_VALOR.has(nome)) {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`--${nome} precisa de um valor`);
      args[nome] = v;
    } else {
      throw new Error(`Opção desconhecida: ${a}`);
    }
  }
  return args;
}

// Devolve a mensagem de erro de validação, ou null se os args estão ok.
export function validarArgs(args) {
  if (!args["env-file"]) return "--env-file é obrigatório";
  if (args.ambiente !== "staging" && args.ambiente !== "prod") {
    return "--ambiente staging|prod é obrigatório";
  }
  if (args.ambiente === "prod" && !args["confirmar-prod"]) {
    return "ambiente prod exige --confirmar-prod";
  }
  if ((args.apply || args["remover-antigos"]) && !args["backup-dir"]) {
    return "--apply e --remover-antigos exigem --backup-dir (pasta fora do repo)";
  }
  return null;
}
