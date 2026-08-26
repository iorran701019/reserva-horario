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
