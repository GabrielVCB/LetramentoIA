# Sentinela — Governança, Auditoria e Letramento em IA

Projeto acadêmico da disciplina de **Gestão de Pessoas**. O objetivo é reduzir o vazamento
de informações corporativas para IAs públicas (ChatGPT, Gemini, Claude e Copilot) por falta
de letramento, sem vigiar o conteúdo das conversas.

A solução tem três peças:

1. **Painel web** (esta aplicação, React + Convex) — landing, login, relatórios, CRUD de
   regras/áreas/mensagens, auditoria de alertas e um laboratório que simula a extensão.
2. **Extensão Chrome Manifest V3** (`extensao/`) — analisa o texto localmente, avisa via
   Shadow DOM e intercepta o envio em risco médio/alto.
3. **Servidor Flask + SQLite** (`servidor/`) — API JSON para a extensão e painel
   administrativo completo, tudo local e sem serviços externos.

> **Privacidade por desenho:** o texto digitado nunca é enviado nem armazenado. O alerta
> contém apenas site, departamento, colaborador (opcional), nível de risco, tipos detectados
> e a ação (`enviou` ou `cancelou`).

---

## Como baixar o projeto

Você pode clonar este repositório via Git ou baixar o código-fonte completo em formato ZIP:

* **[Clique aqui para baixar o projeto (.zip)](https://github.com/GabrielVCB/LetramentoIA/archive/refs/heads/main.zip)**


## 1. Como está organizado

```
projeto/
  extensao/                 Extensão Chrome (MV3, JavaScript puro)
    manifest.json
    detectores.js           Motor local (CPF/CNPJ, tokens, senhas, cartões, código…)
    content.js              Leitura do campo, banner Shadow DOM, interceptação
    background.js           Service worker, sync a cada 5 min, fila offline
    popup.html / popup.js
    options.html / options.js
    estilos.css

  servidor/                 Flask + SQLite (entrega local)
    app.py                  Rotas públicas, login, API admin, relatórios, CSV
    db.py                   Esquema, seed da matriz e do admin
    requirements.txt
    test_app.py             15 testes com o Flask test client
    templates/              base.html, login.html, painel.html
    static/                 painel.css, painel.js

  src/                      Painel web (Vite + React 19 + Convex)
    convex/                 schema, seed, painel (API e relatórios)
    lib/                    detectores.ts, matriz de risco e utilitários
    pages/                  Landing, Auth, Dashboard
    components/painel/      Seções do painel, banner, gráficos SVG

  tests/
    detectores.test.ts      20 testes do motor (Bun)
    extensao.test.mjs       8 testes do motor da extensão (Node)

  README.md
```

As duas implementações do painel compartilham a mesma matriz de risco e a mesma regra de
classificação: **um item de risco alto eleva a mensagem a risco alto; sem itens altos, um
médio eleva a risco médio; caso contrário, baixo**.

---

## 2. Rodar o painel web (React + Convex)

O painel hospedado já está configurado. Para rodar localmente:

```powershell
bun install
bun convex dev --once   # gera tipos e envia as funções
bun run dev             # abre em http://localhost:5173
```

Acesse `/`, clique em **Entrar** e use e-mail (código OTP) ou **Entrar como convidado**.
O primeiro carregamento semeia a matriz de risco, as mensagens educativas e uma amostra de
alertas para o painel não nascer vazio.

> Esta versão web usa Convex como banco e carrega as fontes do Google. A entrega local
> (`servidor/` + `extensao/`) é autocontida: Flask, SQLite, JavaScript e fontes do sistema,
> sem nenhum serviço externo.

Rotas:

- `/` — landing com demonstração ao vivo da análise.
- `/auth` — login por e-mail ou convidado (`returnTo` preservado).
- `/dashboard` — visão geral, regras, áreas, mensagens, auditoria e laboratório.

> A amostra de demonstração é marcada como “amostra” na auditoria e pode ser removida em
> **Alertas → Limpar tudo**.

---

## 3. Rodar o servidor Flask (Windows / PowerShell)

Pré-requisito: Python 3.10 ou superior.

```powershell
cd servidor
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Se o PowerShell bloquear a ativação do venv:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Defina as configurações (os valores abaixo são apenas exemplo; troque-os):

```powershell
$env:SENTINELA_API_TOKEN   = "um-token-longo-e-aleatorio"
$env:SENTINELA_ADMIN_USUARIO = "admin"
$env:SENTINELA_ADMIN_SENHA   = "uma-senha-forte"
$env:SENTINELA_SECRET_KEY    = "outra-chave-aleatoria"
python app.py
```

Abra **http://localhost:5000** e entre com o usuário/senha definidos acima. Sem variáveis
de ambiente, o servidor usa valores de desenvolvimento (`admin` / `admin123` e
`dev-token-sentinela`) e avisa no console — nunca use isso fora do ambiente acadêmico.

O SQLite é criado automaticamente em `servidor/sentinela.db`, junto com a matriz de risco,
as mensagens e o usuário administrador. Para recomeçar do zero, pare o servidor e apague
esse arquivo.

---

## 4. Instalar a extensão no Chrome

1. Abra **chrome://extensions**.
2. Ative o **Modo de programador/desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta `extensao/`.
4. Na extensão clique em **Detalhes/Saiba mais** e abra **Opções de extensão**.
5. Preencha:
   - URL do servidor: `http://localhost:5000`
   - Token de API: o mesmo de `SENTINELA_API_TOKEN`
   - Departamento: ex. `RH`
   - Colaborador: opcional (vazio = anônimo)
6. Clique em **Testar conexão** e depois em **Sincronizar regras agora**.
7. Abra `https://chatgpt.com`, escreva uma mensagem e observe o aviso.

A extensão mantém a última configuração sincronizada em `chrome.storage.local` e funciona
offline com esse cache. Alertas sem servidor entram numa fila local (máximo de 100) e são
reenviados na próxima sincronização ou pelo botão **Reenviar fila**.

### Fluxo de interceptação

- Enter sem Shift e clique no botão de enviar são capturados na fase de captura.
- Risco médio ou alto → modal com **Cancelar e revisar** e **Enviar mesmo assim**.
- “Cancelar e revisar” mantém o texto e registra `acao = "cancelou"`.
- “Enviar mesmo assim” registra `acao = "enviou"` e tenta reenviar o clique original.
- Risco baixo sem detecções → nenhum alerta é criado.
- Risco baixo com detecções (ex.: nome de fornecedor) → alerta `enviou` após o envio.

> Em alguns sites o evento sintético usado para reenviar a mensagem pode ser ignorado. Se
> isso acontecer, o texto continua no campo: basta pressionar Enter novamente.

---
