// Compressão de imagem client-side, só com canvas — o projeto não tem (nem
// passa a ter) dependência de compressão. Usada no upload do comprovante de
// Pix (ver BlocoConfirmacaoPix): foto de tela/print de banco vinda do celular
// costuma ter vários MB, e o que a dona precisa ver cabe folgado em ~1600px.
//
// NUNCA lança e NUNCA piora o arquivo: qualquer falha (formato que o browser
// não decodifica, canvas indisponível, resultado maior que o original) devolve
// o `file` original. Quem chama pode sempre subir o retorno direto.
//
// Sempre devolve JPEG quando comprime — o `type`/`name` do retorno já refletem
// isso, então o chamador deve derivar a extensão do arquivo RETORNADO, não do
// original.
export async function comprimirImagem(
  file,
  { larguraMax = 1600, alturaMax = 1600, qualidade = 0.8 } = {}
) {
  if (!file?.type?.startsWith("image/")) return file;

  try {
    const bitmap = await createImageBitmap(file);

    const escala = Math.min(
      1,
      larguraMax / bitmap.width,
      alturaMax / bitmap.height
    );
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));

    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    // Fundo branco antes de desenhar: PNG/WebP com transparência viraria preto
    // no JPEG, e comprovante com fundo preto é ilegível.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close?.();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", qualidade)
    );
    if (!blob || blob.size >= file.size) return file;

    const nomeBase = file.name.replace(/\.[^.]+$/, "") || "comprovante";
    return new File([blob], `${nomeBase}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } catch {
    return file;
  }
}

// ---------------------------------------------------------------------------
// Fotos de categoria e de perfil (egress do Storage).
//
// Diferente de comprimirImagem, aqui NÃO existe fallback pro original: foto
// que não decodifica ou que não pode ser comprimida é recusada, porque subir
// o arquivo cru de celular é justamente o que estoura o egress do bucket.
export const TAMANHO_MAX_FOTO_BYTES = 10 * 1024 * 1024;
export const LADO_MAX_FOTO_CATEGORIA = 1600;
export const LADO_MAX_FOTO_PERFIL = 800;
export const QUALIDADE_FOTO = 0.8;
export const CACHE_CONTROL_FOTO = "31536000";

const MSG_FOTO_GRANDE = "A foto é muito grande (máximo 10 MB). Escolha outra foto menor.";
const MSG_FOTO_ILEGIVEL =
  "Não foi possível abrir essa foto (formatos como HEIC podem não funcionar neste aparelho). Escolha outra foto ou tire um print dela.";

// Devolve { file } (sempre JPEG, lado maior <= ladoMax) ou { erro } com a
// mensagem pra mostrar pra dona. Nunca devolve o arquivo original.
export async function prepararFotoParaUpload(
  file,
  { ladoMax, qualidade = QUALIDADE_FOTO, tamanhoMax = TAMANHO_MAX_FOTO_BYTES }
) {
  if (!file) return { erro: MSG_FOTO_ILEGIVEL };
  if (file.size > tamanhoMax) return { erro: MSG_FOTO_GRANDE };

  try {
    // from-image: respeita a rotação EXIF das fotos de celular no canvas.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });

    const escala = Math.min(1, ladoMax / bitmap.width, ladoMax / bitmap.height);
    const largura = Math.max(1, Math.round(bitmap.width * escala));
    const altura = Math.max(1, Math.round(bitmap.height * escala));

    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { erro: MSG_FOTO_ILEGIVEL };

    // Fundo branco: PNG/WebP com transparência viraria preto no JPEG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    bitmap.close?.();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", qualidade)
    );
    if (!blob) return { erro: MSG_FOTO_ILEGIVEL };

    return {
      file: new File([blob], "foto.jpg", {
        type: "image/jpeg",
        lastModified: Date.now(),
      }),
    };
  } catch {
    return { erro: MSG_FOTO_ILEGIVEL };
  }
}

// Caminho do arquivo ANTIGO no bucket, a partir da URL pública salva (com
// ?v=), só quando é seguro apagá-lo: está na pasta do próprio estabelecimento
// e é diferente do caminho novo. Senão devolve null.
export function caminhoAntigoParaRemover(urlAntiga, bucket, estabelecimentoId, caminhoNovo) {
  if (!urlAntiga || typeof urlAntiga !== "string") return null;
  const marcador = `/${bucket}/`;
  const semQuery = urlAntiga.split("?")[0].split("#")[0];
  const i = semQuery.indexOf(marcador);
  if (i === -1) return null;
  let caminho;
  try {
    caminho = decodeURIComponent(semQuery.slice(i + marcador.length));
  } catch {
    return null;
  }
  const prefixo = `${estabelecimentoId}/`;
  if (!caminho.startsWith(prefixo)) return null;
  if (caminho.slice(prefixo.length).includes("/")) return null;
  if (caminho === caminhoNovo) return null;
  return caminho;
}
