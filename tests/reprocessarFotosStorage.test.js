import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  antigosRemoviveis,
  caminhoBackup,
  caminhoDaUrl,
  caminhoDestino,
  decidirAcao,
  deveGravar,
  estaDentro,
  jpgPequenoPodePular,
  lerArgs,
  validarArgs,
} from "@/scripts/fotosStorage.mjs";

const base = "https://x.supabase.co/storage/v1/object/public/fotos-perfil";

describe("fotosStorage", () => {
  it("caminhoDaUrl tira o ?v= e rejeita outro bucket", () => {
    expect(caminhoDaUrl(`${base}/5/perfil.png?v=1`, "fotos-perfil")).toBe("5/perfil.png");
    expect(caminhoDaUrl(`${base}/5/perfil.png`, "fotos-categorias")).toBeNull();
    expect(caminhoDaUrl(null, "fotos-perfil")).toBeNull();
  });

  it("caminhoDestino troca qualquer extensão por .jpg", () => {
    expect(caminhoDestino("5/perfil.png")).toBe("5/perfil.jpg");
    expect(caminhoDestino("4/1.jpg")).toBe("4/1.jpg");
    expect(caminhoDestino("4/4.heic")).toBe("4/4.jpg");
  });

  it("decidirAcao: heic pula, jpg pequeno pula, o resto reprocessa", () => {
    expect(decidirAcao({ caminho: "4/4.heic", tamanho: 6e6 }).acao).toBe("pular");
    expect(decidirAcao({ caminho: "4/2.jpg", tamanho: 100 * 1024 }).acao).toBe("pular");
    expect(decidirAcao({ caminho: "4/1.jpg", tamanho: 7e6 }).acao).toBe("reprocessar");
    expect(decidirAcao({ caminho: "5/perfil.png", tamanho: 10 * 1024 }).acao).toBe("reprocessar");
  });

  it("jpgPequenoPodePular exige o lado dentro do limite", () => {
    const c = { caminho: "4/2.jpg", tamanho: 100 * 1024, ladoMax: 1600 };
    expect(jpgPequenoPodePular({ ...c, largura: 1600, altura: 900 })).toBe(true);
    expect(jpgPequenoPodePular({ ...c, largura: 4000, altura: 900 })).toBe(false);
    expect(jpgPequenoPodePular({ ...c, tamanho: 500 * 1024, largura: 10, altura: 10 })).toBe(false);
  });

  it("deveGravar só se o novo for pelo menos 10% menor", () => {
    expect(deveGravar(89, 100)).toBe(true);
    expect(deveGravar(90, 100)).toBe(false);
    expect(deveGravar(99, 100)).toBe(false);
    expect(deveGravar(101, 100)).toBe(false);
  });

  it("antigosRemoviveis exige irmão .jpg referenciado e ignora referenciados", () => {
    const objetos = ["5/perfil.png", "5/perfil.jpg", "4/4.heic", "7/a.png"];
    const refs = new Set(["5/perfil.jpg", "4/4.heic"]);
    expect(antigosRemoviveis(objetos, refs)).toEqual(["5/perfil.png"]);
  });

  it("caminhoBackup bloqueia path traversal", () => {
    expect(caminhoBackup("C:/bk", "staging", "fotos-perfil", "5/perfil.png")).toBe(
      path.resolve("C:/bk", "staging", "fotos-perfil", "5", "perfil.png")
    );
    expect(() => caminhoBackup("C:/bk", "staging", "fotos-perfil", "../x.png")).toThrow();
  });

  it("estaDentro", () => {
    expect(estaDentro("C:/repo", "C:/repo/backup")).toBe(true);
    expect(estaDentro("C:/repo", "C:/outro")).toBe(false);
  });

  it("validarArgs", () => {
    expect(validarArgs(lerArgs([]))).toMatch(/env-file/);
    expect(validarArgs(lerArgs(["--env-file", "e", "--ambiente", "prod"]))).toMatch(/confirmar-prod/);
    expect(validarArgs(lerArgs(["--env-file", "e", "--ambiente", "staging", "--apply"]))).toMatch(/backup-dir/);
    expect(validarArgs(lerArgs(["--env-file", "e", "--ambiente", "staging"]))).toBeNull();
    expect(() => lerArgs(["--foo"])).toThrow();
  });
});
