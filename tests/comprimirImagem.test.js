import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  prepararFotoParaUpload,
  caminhoAntigoParaRemover,
  TAMANHO_MAX_FOTO_BYTES,
} from "@/lib/comprimirImagem";

function arquivo(tamanho, type = "image/png", name = "a.png") {
  return new File([new Uint8Array(tamanho)], name, { type });
}

describe("prepararFotoParaUpload", () => {
  let desenhado;
  beforeEach(() => {
    desenhado = null;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4000, height: 2000, close() {} }))
    );
    vi.spyOn(document, "createElement").mockImplementation((tag) => {
      if (tag !== "canvas") return {};
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          fillRect() {},
          drawImage(_b, _x, _y, w, h) {
            desenhado = { w, h };
          },
        }),
        toBlob(cb, tipo) {
          cb(new Blob(["x"], { type: tipo }));
        },
      };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("recusa arquivo acima do limite sem decodificar", async () => {
    const r = await prepararFotoParaUpload(arquivo(TAMANHO_MAX_FOTO_BYTES + 1), { ladoMax: 800 });
    expect(r.erro).toMatch(/10 MB/);
    expect(r.file).toBeUndefined();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("recusa quando o navegador não decodifica (HEIC) e não devolve o original", async () => {
    createImageBitmap.mockRejectedValueOnce(new Error("nope"));
    const r = await prepararFotoParaUpload(arquivo(100, "image/heic", "a.heic"), { ladoMax: 800 });
    expect(r.erro).toMatch(/HEIC/);
    expect(r.file).toBeUndefined();
  });

  it("converte PNG em JPEG e limita o lado maior", async () => {
    const r = await prepararFotoParaUpload(arquivo(100), { ladoMax: 800 });
    expect(r.file.type).toBe("image/jpeg");
    expect(r.file.name).toBe("foto.jpg");
    expect(desenhado).toEqual({ w: 800, h: 400 });
  });

  it("não amplia imagem pequena", async () => {
    createImageBitmap.mockResolvedValueOnce({ width: 300, height: 200, close() {} });
    await prepararFotoParaUpload(arquivo(100), { ladoMax: 800 });
    expect(desenhado).toEqual({ w: 300, h: 200 });
  });

  it("recusa quando o canvas não gera blob", async () => {
    document.createElement.mockImplementation(() => ({
      getContext: () => ({ fillRect() {}, drawImage() {} }),
      toBlob: (cb) => cb(null),
    }));
    const r = await prepararFotoParaUpload(arquivo(100), { ladoMax: 800 });
    expect(r.erro).toBeTruthy();
  });
});

describe("caminhoAntigoParaRemover", () => {
  const base = "https://x.supabase.co/storage/v1/object/public/fotos-perfil";
  it("devolve o caminho sem o ?v= quando a extensão difere", () => {
    expect(caminhoAntigoParaRemover(`${base}/7/perfil.png?v=123`, "fotos-perfil", 7, "7/perfil.jpg")).toBe("7/perfil.png");
  });
  it("null quando é o mesmo caminho", () => {
    expect(caminhoAntigoParaRemover(`${base}/7/perfil.jpg?v=1`, "fotos-perfil", 7, "7/perfil.jpg")).toBeNull();
  });
  it("null quando está na pasta de outro estabelecimento", () => {
    expect(caminhoAntigoParaRemover(`${base}/8/perfil.png`, "fotos-perfil", 7, "7/perfil.jpg")).toBeNull();
  });
  it("null para URL vazia, de outro bucket ou com subpasta", () => {
    expect(caminhoAntigoParaRemover(null, "fotos-perfil", 7, "7/perfil.jpg")).toBeNull();
    expect(caminhoAntigoParaRemover(`${base}/7/perfil.png`, "fotos-categorias", 7, "7/1.jpg")).toBeNull();
    expect(caminhoAntigoParaRemover(`${base}/7/a/perfil.png`, "fotos-perfil", 7, "7/perfil.jpg")).toBeNull();
  });
});
