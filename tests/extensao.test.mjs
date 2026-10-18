/**
 * Testa o motor da extensão exatamente como ele roda no content script,
 * carregando extensao/detectores.js em um contexto isolado (vm).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const codigo = fs.readFileSync(new URL("../extensao/detectores.js", import.meta.url), "utf8");
const contexto = vm.createContext({ console });
vm.runInContext(codigo, contexto);
const motor = contexto.PainelDetectores;

const REGRA_SALARIO = {
  nome: "Salário",
  area: "RH",
  tipo: "palavra-chave",
  padrao: "salário, holerite",
  risco: "alto",
  ativo: true,
};

test("motor da extensão é exposto no contexto", () => {
  assert.equal(typeof motor.analisarTexto, "function");
  assert.equal(typeof motor.validarCPF, "function");
});

test("CPF válido é detectado; inválido é ignorado", () => {
  const valido = motor.analisarTexto("CPF 529.982.247-25");
  assert.equal(valido.nivel, "alto");
  assert.equal(valido.deteccoes[0].tipo, "CPF");
  assert.equal(valido.deteccoes[0].area, "RH");

  const invalido = motor.analisarTexto("CPF 529.982.247-24");
  assert.equal(invalido.nivel, "baixo");
  assert.equal(invalido.deteccoes.length, 0);
});

test("classificação geral Alto > Médio > Baixo", () => {
  assert.equal(motor.classificar([]), "baixo");
  assert.equal(
    motor.classificar([{ risco: "baixo" }, { risco: "medio" }]),
    "medio",
  );
  assert.equal(
    motor.classificar([{ risco: "baixo" }, { risco: "medio" }, { risco: "alto" }]),
    "alto",
  );
});

test("regra de palavra-chave ignora acentuação", () => {
  const comAcento = motor.analisarTexto("Preciso do salário de outubro", [REGRA_SALARIO]);
  assert.equal(comAcento.deteccoes[0].tipo, "Salário");

  const semAcento = motor.analisarTexto("Preciso do salario de outubro", [REGRA_SALARIO]);
  assert.equal(semAcento.deteccoes[0].tipo, "Salário");
});

test("token e IP privado são risco alto", () => {
  assert.equal(motor.analisarTexto("sk-proj-8fJ2kLm9Qr4Tz7Xb1Nc6Vd3").nivel, "alto");
  assert.equal(motor.analisarTexto("Servidor 192.168.0.15").deteccoes[0].tipo, "IP ou servidor interno");
});

test("texto vazio e texto comum não geram alerta", () => {
  assert.equal(motor.analisarTexto("").deteccoes.length, 0);
  assert.equal(motor.analisarTexto("Bom dia, tudo bem?").nivel, "baixo");
});

test("regra regex inválida não lança exceção", () => {
  const analise = motor.analisarTexto("teste", [
    { nome: "Quebrada", area: "TI", tipo: "regex", padrao: "([a-z", risco: "alto", ativo: true },
  ]);
  assert.equal(analise.nivel, "baixo");
});

test("Luhn e CNPJ", () => {
  assert.equal(motor.validarLuhn("4111 1111 1111 1111"), true);
  assert.equal(motor.validarLuhn("4111 1111 1111 1112"), false);
  assert.equal(motor.validarCNPJ("11.222.333/0001-81"), true);
  assert.equal(motor.validarCNPJ("11.222.333/0001-82"), false);
});
