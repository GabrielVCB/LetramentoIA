"""
Testes do servidor Flask usando o test client (sem subir a porta).

Executar em PowerShell, dentro da pasta servidor, com o venv ativo:
    python -m unittest test_app.py -v
"""
import os
import tempfile
import unittest

# Variáveis de ambiente precisam existir ANTES de importar app.py,
# porque a inicialização do banco usa esses valores.
DIRETORIO_TESTE = tempfile.mkdtemp(prefix="sentinela-teste-")
os.environ["SENTINELA_DB"] = os.path.join(DIRETORIO_TESTE, "teste.db")
os.environ["SENTINELA_API_TOKEN"] = "token-de-teste"
os.environ["SENTINELA_ADMIN_USUARIO"] = "admin_teste"
os.environ["SENTINELA_ADMIN_SENHA"] = "senha-de-teste"
os.environ["SENTINELA_SECRET_KEY"] = "segredo-de-teste"

import app as servidor  # noqa: E402  (import após configurar o ambiente)

TOKEN = {"X-API-Token": "token-de-teste"}


class BaseSentinela(unittest.TestCase):
    def setUp(self):
        conexao = servidor.conexao()
        try:
            conexao.execute("DELETE FROM alertas")
            conexao.commit()
        finally:
            conexao.close()
        self.client = servidor.app.test_client()

    def entrar(self):
        resposta = self.client.post(
            "/login",
            data={"usuario": "admin_teste", "senha": "senha-de-teste"},
            follow_redirects=False,
        )
        self.assertEqual(resposta.status_code, 302)

    def criar_alerta(self, **alteracoes):
        payload = {
            "data_hora": "2026-10-18T10:00:00",
            "site": "chatgpt.com",
            "departamento": "RH",
            "colaborador": "ana.silva",
            "nivel_risco": "alto",
            "acao": "enviou",
            "tipos_detectados": [
                {"tipo_detectado": "CPF", "risco": "alto", "area": "RH"}
            ],
        }
        payload.update(alteracoes)
        return self.client.post("/api/alertas", json=payload, headers=TOKEN)


class TestRotasPublicas(BaseSentinela):
    def test_ping(self):
        resposta = self.client.get("/api/ping")
        self.assertEqual(resposta.status_code, 200)
        self.assertTrue(resposta.get_json()["ok"])

    def test_config_traz_matriz_e_mensagens(self):
        resposta = self.client.get("/api/config")
        self.assertEqual(resposta.status_code, 200)
        corpo = resposta.get_json()
        self.assertEqual(len(corpo["regras"]), 44)
        self.assertEqual(set(corpo["mensagens"].keys()), {"baixo", "medio", "alto"})
        self.assertTrue(all(regra["ativo"] for regra in corpo["regras"]))
        areas = [regra["area"] for regra in corpo["regras"]]
        self.assertIn("RH", areas)
        self.assertIn("Segurança da Informação", areas)

        # As regras de palavra-chave são bilíngues.
        salario = next(regra for regra in corpo["regras"] if regra["nome"] == "Salário")
        self.assertIn("salary", salario["padrao"])
        senha = next(regra for regra in corpo["regras"] if regra["nome"] == "Senha ou credencial")
        self.assertIn("password", senha["padrao"])

    def test_alerta_exige_token(self):
        resposta = self.client.post("/api/alertas", json={"site": "chatgpt.com"})
        self.assertEqual(resposta.status_code, 400)
        self.assertIn("Token", resposta.get_json()["erro"])

    def test_alerta_invalido_e_rejeitado(self):
        resposta = self.client.post(
            "/api/alertas",
            json={"site": "x", "departamento": "RH", "nivel_risco": "extremo", "acao": "enviou"},
            headers=TOKEN,
        )
        self.assertEqual(resposta.status_code, 400)

    def test_alerta_registra_somente_metadados_e_recalcula_risco(self):
        resposta = self.criar_alerta(nivel_risco="baixo")
        self.assertEqual(resposta.status_code, 201)

        self.entrar()
        listagem = self.client.get("/api/admin/alertas?nivel=alto&departamento=RH")
        self.assertEqual(listagem.status_code, 200)
        dados = listagem.get_json()
        self.assertEqual(dados["total"], 1)
        registro = dados["registros"][0]
        # O servidor eleva para alto por causa do item CPF.
        self.assertEqual(registro["nivel_risco"], "alto")
        self.assertEqual(registro["itens"][0]["tipo_detectado"], "CPF")
        self.assertNotIn("texto", registro)
        self.assertNotIn("mensagem", registro)
        self.assertEqual(registro["origem"], "texto")

    def test_alerta_idempotente_e_origem(self):
        primeiro = self.client.post(
            "/api/alertas",
            json={
                "evento_id": "evento-1",
                "origem": "imagem",
                "site": "chatgpt.com",
                "departamento": "TI",
                "nivel_risco": "alto",
                "acao": "enviou",
                "tipos_detectados": [
                    {"tipo_detectado": "Token ou chave de API", "risco": "alto", "area": "TI"}
                ],
            },
            headers=TOKEN,
        )
        self.assertEqual(primeiro.status_code, 201)

        repetido = self.client.post(
            "/api/alertas",
            json={
                "evento_id": "evento-1",
                "origem": "imagem",
                "site": "chatgpt.com",
                "departamento": "TI",
                "nivel_risco": "alto",
                "acao": "enviou",
                "tipos_detectados": [],
            },
            headers=TOKEN,
        )
        self.assertEqual(repetido.status_code, 200)
        self.assertTrue(repetido.get_json()["duplicado"])

        self.entrar()
        listagem = self.client.get("/api/admin/alertas").get_json()
        self.assertEqual(listagem["total"], 1)
        self.assertEqual(listagem["registros"][0]["origem"], "imagem")

    def test_api_admin_sem_sessao_retorna_401(self):
        self.assertEqual(self.client.get("/api/admin/resumo").status_code, 401)
        self.assertEqual(self.client.get("/api/admin/regras").status_code, 401)


class TestAutenticacao(BaseSentinela):
    def test_login_errado_e_logout(self):
        resposta = self.client.post(
            "/login", data={"usuario": "admin_teste", "senha": "errada"}
        )
        self.assertEqual(resposta.status_code, 401)
        self.assertIn(b"inv\xc3\xa1lidos", resposta.data)

    def test_landing_e_publica_e_painel_exige_login(self):
        inicio = self.client.get("/")
        self.assertEqual(inicio.status_code, 200)
        self.assertIn(b"Entrar no painel", inicio.data)
        self.assertIn(b"lp-demo", inicio.data)
        self.assertNotIn(b"Projeto acad\xc3\xaanico", inicio.data)

        painel = self.client.get("/painel", follow_redirects=False)
        self.assertEqual(painel.status_code, 302)
        self.assertIn("/login", painel.headers["Location"])

    def test_login_page_e_arquivos_estaticos(self):
        pagina = self.client.get("/login")
        self.assertEqual(pagina.status_code, 200)
        self.assertIn(b"Entrar no painel", pagina.data)
        self.assertIn(b"painel.css", pagina.data)

        css = self.client.get("/static/painel.css")
        self.assertEqual(css.status_code, 200)
        self.assertIn("text/css", css.headers["Content-Type"])

        javascript = self.client.get("/static/painel.js")
        self.assertEqual(javascript.status_code, 200)

    def test_login_correto_abre_painel(self):
        self.entrar()
        resposta = self.client.get("/painel")
        self.assertEqual(resposta.status_code, 200)
        self.assertIn(b"Sentinela", resposta.data)

        saida = self.client.get("/logout", follow_redirects=False)
        self.assertEqual(saida.status_code, 302)
        self.assertEqual(self.client.get("/api/admin/resumo").status_code, 401)


class TestRelatorios(BaseSentinela):
    def test_resumo_gargalo_e_csv(self):
        for indice in range(3):
            resposta = self.criar_alerta(
                colaborador="colaborador-%d" % indice,
                acao="cancelou" if indice == 0 else "enviou",
            )
            self.assertEqual(resposta.status_code, 201)
        self.criar_alerta(
            departamento="Financeiro",
            tipos_detectados=[
                {"tipo_detectado": "Orçamento interno", "risco": "medio", "area": "Financeiro"}
            ],
            nivel_risco="medio",
        )

        self.entrar()
        resposta = self.client.get("/api/admin/resumo?limiar=30")
        self.assertEqual(resposta.status_code, 200)
        corpo = resposta.get_json()

        self.assertEqual(corpo["total"], 4)
        self.assertEqual(corpo["total_alto"], 3)
        self.assertEqual(corpo["total_cancelou"], 1)
        self.assertEqual(corpo["gargalos"][0]["departamento"], "RH")
        self.assertGreaterEqual(len(corpo["evolucao"]), 14)
        self.assertTrue(any(tipo["tipo"] == "CPF" for tipo in corpo["tipos"]))

        csv = self.client.get("/api/admin/exportar.csv")
        self.assertEqual(csv.status_code, 200)
        self.assertIn("text/csv", csv.headers["Content-Type"])
        texto = csv.data.decode("utf-8-sig")
        self.assertTrue(texto.startswith("Data/hora;Site;Origem;Departamento"))
        self.assertIn("CPF", texto)

    def test_filtros_paginacao_detalhe_e_exclusao(self):
        for indice in range(15):
            self.criar_alerta(
                data_hora="2026-10-%02dT09:00:00" % (indice + 1),
                acao="enviou" if indice % 2 == 0 else "cancelou",
            )

        self.entrar()
        pagina = self.client.get("/api/admin/alertas?pagina=1&por_pagina=10")
        self.assertEqual(pagina.status_code, 200)
        dados = pagina.get_json()
        self.assertEqual(dados["total"], 15)
        self.assertEqual(len(dados["registros"]), 10)
        self.assertEqual(dados["total_paginas"], 2)

        filtrado = self.client.get("/api/admin/alertas?nivel=alto&departamento=RH")
        self.assertEqual(filtrado.get_json()["total"], 15)

        alerta_id = dados["registros"][0]["id"]
        detalhe = self.client.get("/api/admin/alertas/%d" % alerta_id)
        self.assertEqual(detalhe.status_code, 200)
        self.assertEqual(detalhe.get_json()["itens"][0]["tipo_detectado"], "CPF")

        removido = self.client.delete("/api/admin/alertas/%d" % alerta_id)
        self.assertEqual(removido.status_code, 200)
        self.assertEqual(
            self.client.get("/api/admin/alertas/%d" % alerta_id).status_code, 404
        )

    def test_limpeza_por_idade_e_total(self):
        self.criar_alerta(data_hora="2020-01-01T08:00:00")
        self.criar_alerta(data_hora="2026-10-18T08:00:00")

        self.entrar()
        limpeza = self.client.post("/api/admin/alertas/limpar-idade", json={"dias": 30})
        self.assertEqual(limpeza.status_code, 200)
        self.assertEqual(limpeza.get_json()["removidos"], 1)

        total = self.client.delete("/api/admin/alertas")
        self.assertEqual(total.status_code, 200)
        self.assertEqual(total.get_json()["removidos"], 1)


class TestCrud(BaseSentinela):
    def test_area_regra_e_mensagem(self):
        self.entrar()

        area = self.client.post(
            "/api/admin/areas",
            json={"nome": "Operações", "descricao": "Rotinas internas"},
        )
        self.assertEqual(area.status_code, 201)
        area_id = area.get_json()["id"]

        duplicada = self.client.post("/api/admin/areas", json={"nome": "Operações"})
        self.assertEqual(duplicada.status_code, 409)

        regra_invalida = self.client.post(
            "/api/admin/regras",
            json={
                "area_id": area_id,
                "nome": "Quebrada",
                "tipo": "regex",
                "padrao": "([a-z",
                "risco": "alto",
                "ativo": True,
            },
        )
        self.assertEqual(regra_invalida.status_code, 400)

        regra = self.client.post(
            "/api/admin/regras",
            json={
                "area_id": area_id,
                "nome": "Rota de entrega",
                "tipo": "palavra-chave",
                "padrao": "rota, entrega",
                "risco": "medio",
                "ativo": True,
            },
        )
        self.assertEqual(regra.status_code, 201)
        regra_id = regra.get_json()["id"]

        atualizada = self.client.put(
            "/api/admin/regras/%d" % regra_id,
            json={
                "area_id": area_id,
                "nome": "Rota de entrega",
                "tipo": "palavra-chave",
                "padrao": "rota, entrega, logística",
                "risco": "alto",
                "ativo": False,
            },
        )
        self.assertEqual(atualizada.status_code, 200)
        regras = self.client.get("/api/admin/regras").get_json()
        salva = next(item for item in regras if item["id"] == regra_id)
        self.assertFalse(salva["ativo"])
        self.assertEqual(salva["risco"], "alto")

        area_atualizada = self.client.put(
            "/api/admin/areas/%d" % area_id,
            json={"nome": "Operações Brasil", "descricao": "Atualizada"},
        )
        self.assertEqual(area_atualizada.status_code, 200)

        mensagem = self.client.put(
            "/api/admin/mensagens/alto", json={"texto": "Não compartilhe este conteúdo."}
        )
        self.assertEqual(mensagem.status_code, 200)
        mensagens = self.client.get("/api/admin/mensagens").get_json()
        alto = next(item for item in mensagens if item["nivel"] == "alto")
        self.assertEqual(alto["texto"], "Não compartilhe este conteúdo.")

        remocao = self.client.delete("/api/admin/areas/%d" % area_id)
        self.assertEqual(remocao.status_code, 200)
        self.assertEqual(remocao.get_json()["regras_removidas"], 1)

    def test_configuracoes_de_limiar(self):
        self.entrar()
        resposta = self.client.put(
            "/api/admin/configuracoes", json={"limiar_gargalo": 45}
        )
        self.assertEqual(resposta.status_code, 200)
        self.assertEqual(
            self.client.get("/api/admin/configuracoes").get_json()["limiar_gargalo"], 45
        )
        invalido = self.client.put("/api/admin/configuracoes", json={"limiar_gargalo": 200})
        self.assertEqual(invalido.status_code, 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
