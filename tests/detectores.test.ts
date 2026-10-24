import { describe, expect, test } from "bun:test";
import {
  analisarTexto,
  classificar,
  validarCNPJ,
  validarCPF,
  validarLuhn,
  type RegraEntrada,
} from "../src/lib/detectores";

const regraSalario: RegraEntrada = {
  nome: "Salário",
  area: "RH",
  tipo: "palavra-chave",
  padrao: "salário, salario, remuneração, holerite",
  risco: "alto",
  ativo: true,
};

const regraOrcamento: RegraEntrada = {
  nome: "Orçamento interno",
  area: "Financeiro",
  tipo: "palavra-chave",
  padrao: "orçamento, budget",
  risco: "medio",
  ativo: true,
};

const regraCpf: RegraEntrada = {
  nome: "CPF",
  area: "RH",
  tipo: "regex",
  padrao: "\\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b",
  risco: "alto",
  ativo: true,
};

describe("validadores", () => {
  test("CPF válido com e sem formatação", () => {
    expect(validarCPF("529.982.247-25")).toBe(true);
    expect(validarCPF("52998224725")).toBe(true);
  });

  test("CPF inválido por dígito verificador ou repetição", () => {
    expect(validarCPF("529.982.247-24")).toBe(false);
    expect(validarCPF("111.111.111-11")).toBe(false);
    expect(validarCPF("123")).toBe(false);
  });

  test("CNPJ válido e inválido", () => {
    expect(validarCNPJ("11.222.333/0001-81")).toBe(true);
    expect(validarCNPJ("11.222.333/0001-82")).toBe(false);
    expect(validarCNPJ("00.000.000/0000-00")).toBe(false);
  });

  test("Luhn de cartões", () => {
    expect(validarLuhn("4111 1111 1111 1111")).toBe(true);
    expect(validarLuhn("4111-1111-1111-1112")).toBe(false);
  });
});

describe("detectores embutidos", () => {
  test("CPF válido é risco alto na área de RH", () => {
    const analise = analisarTexto("Segue o CPF do colaborador: 529.982.247-25.");
    expect(analise.nivel).toBe("alto");
    expect(analise.deteccoes).toEqual([
      { tipo: "CPF", area: "RH", risco: "alto", ocorrencias: 1 },
    ]);
  });

  test("CPF inválido não gera detecção", () => {
    const analise = analisarTexto("O número 111.111.111-11 apareceu no teste.");
    expect(analise.deteccoes).toHaveLength(0);
    expect(analise.nivel).toBe("baixo");
  });

  test("token de API e senha são risco alto", () => {
    const comToken = analisarTexto("Minha chave: sk-proj-8fJ2kLm9Qr4Tz7Xb1Nc6Vd3");
    expect(comToken.nivel).toBe("alto");
    expect(comToken.deteccoes.some((item) => item.tipo === "Token ou chave de API")).toBe(true);

    const comSenha = analisarTexto("Acesso: senha: inverno2026");
    expect(comSenha.deteccoes.some((item) => item.tipo === "Senha ou credencial")).toBe(true);
  });

  test("IP privado é detectado, IP público não", () => {
    expect(analisarTexto("Servidor 10.20.30.41 fora do ar").nivel).toBe("alto");
    expect(analisarTexto("Acesse 192.168.0.10").deteccoes[0]?.tipo).toBe(
      "IP ou servidor interno",
    );
    const publico = analisarTexto("O DNS 8.8.8.8 respondeu rápido");
    expect(publico.nivel).toBe("baixo");
  });

  test("hostname interno e cartão válido", () => {
    expect(analisarTexto("Conecte em db01.corp para ver").nivel).toBe("alto");
    const cartao = analisarTexto("Cartão 4111 1111 1111 1111 do cliente");
    expect(cartao.deteccoes.some((item) => item.tipo === "Número de cartão")).toBe(true);
  });

  test("trecho de código é reconhecido pela heurística", () => {
    const analise = analisarTexto("function login(user) {\n  return true;\n}");
    expect(analise.deteccoes.some((item) => item.tipo === "Código-fonte interno")).toBe(true);
  });

  test("texto comum não gera detecção", () => {
    const analise = analisarTexto("Pode revisar a redação deste e-mail de agradecimento?");
    expect(analise.deteccoes).toHaveLength(0);
    expect(analise.nivel).toBe("baixo");
  });
});

describe("regras editáveis", () => {
  test("palavra-chave detecta com acento e sem acento", () => {
    const comAcento = analisarTexto("Preciso ver o salário do time.", [regraSalario]);
    expect(comAcento.deteccoes[0]?.tipo).toBe("Salário");

    const semAcento = analisarTexto("Preciso ver o salario do time.", [regraSalario]);
    expect(semAcento.deteccoes[0]?.area).toBe("RH");
  });

  test("regra inativa é ignorada", () => {
    const analise = analisarTexto("O orçamento foi aprovado.", [
      { ...regraOrcamento, ativo: false },
    ]);
    expect(analise.deteccoes).toHaveLength(0);
  });

  test("regra regex inválida não quebra a análise", () => {
    const analise = analisarTexto("texto qualquer", [
      { ...regraCpf, padrao: "([a-z" },
    ]);
    expect(analise.nivel).toBe("baixo");
  });

  test("regra do banco e detector embutido não duplicam o mesmo tipo", () => {
    const analise = analisarTexto("CPF 529.982.247-25", [regraCpf]);
    expect(analise.deteccoes.filter((item) => item.tipo === "CPF")).toHaveLength(1);
  });

  test("regra de risco médio eleva a classificação", () => {
    const analise = analisarTexto("O orçamento interno do trimestre.", [regraOrcamento]);
    expect(analise.nivel).toBe("medio");
  });
});

describe("classificação geral", () => {
  test("sem detecções é baixo", () => {
    expect(classificar([])).toBe("baixo");
  });

  test("apenas baixo continua baixo", () => {
    expect(
      classificar([{ tipo: "Fornecedor", area: "Jurídico", risco: "baixo", ocorrencias: 1 }]),
    ).toBe("baixo");
  });

  test("um médio eleva para médio", () => {
    expect(
      classificar([
        { tipo: "Fornecedor", area: "Jurídico", risco: "baixo", ocorrencias: 1 },
        { tipo: "Contrato", area: "Jurídico", risco: "medio", ocorrencias: 1 },
      ]),
    ).toBe("medio");
  });

  test("um alto vence médio e baixo", () => {
    expect(
      classificar([
        { tipo: "Fornecedor", area: "Jurídico", risco: "baixo", ocorrencias: 1 },
        { tipo: "Contrato", area: "Jurídico", risco: "medio", ocorrencias: 1 },
        { tipo: "Cláusula", area: "Jurídico", risco: "alto", ocorrencias: 1 },
      ]),
    ).toBe("alto");
  });
});
