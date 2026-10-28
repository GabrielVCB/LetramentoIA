# Sentinela — Governança, Auditoria e Letramento em IA

Painel de governança e letramento em IA. O objetivo é reduzir o vazamento de informações
corporativas para IAs públicas (ChatGPT, Gemini, Claude e Copilot) por falta de letramento,
sem vigiar o conteúdo das conversas.

A solução tem três peças:

1. **Painel web** (esta aplicação, React + Convex) — landing, login, relatórios, CRUD de
   regras/áreas/mensagens, auditoria de alertas e um laboratório que simula a extensão.
2. **Extensão Manifest V3** (`extensao/`) — funciona no **Google Chrome e no Microsoft
   Edge**; analisa o texto localmente, avisa via Shadow DOM e intercepta o envio em risco
   médio/alto.
3. **Servidor Flask + banco** (`servidor/`) — API JSON para a extensão e painel
   administrativo completo. Roda na própria máquina (`python app.py`, com SQLite) ou
   publicado na nuvem (`gunicorn app:app`, com Postgres externo e `render.yaml` pronto
   para a Render).

> **Privacidade por desenho:** o texto digitado nunca é enviado nem armazenado. O alerta
> contém apenas site, departamento, colaborador (opcional), nível de risco, tipos detectados
> e a ação (`enviou` ou `cancelou`).

---

## Como baixar o projeto

A prévia disponibiliza um ZIP com todo o código-fonte em **`/sentinela-projeto.zip`**:

- No rodapé da página inicial, clique em **Baixar projeto (.zip)**.
- Ou, no painel autenticado, use **Baixar projeto (.zip)** no rodapé do menu lateral.
- Rodando localmente, o endereço é `http://localhost:5173/sentinela-projeto.zip`.

O botão baixa o arquivo via `fetch` + Blob e mostra o progresso do transferimento
(5,0 MB). Se a prévia estiver rodando dentro de um quadro embutido que bloqueia
downloads, o navegador recusa o arquivo sem avisar; nesse caso abra a prévia em
uma **nova aba** e clique de novo, ou acesse `/sentinela-projeto.zip` direto.

No Windows/PowerShell, descompacte com:

```powershell
Expand-Archive -Path .\sentinela-projeto.zip -DestinationPath .
cd sentinela
```

O ZIP contém o projeto inteiro na versão atual — `src/`, `extensao/`, `servidor/`,
`tests/`, `public/` e os arquivos de configuração — e não um pacote de diferenças.
Ficam de fora, de propósito: `node_modules/`, `dist/`, `.env*`, `servidor/*.db`,
`__pycache__/` e `src/convex/_generated/` (gerado pelo Convex).

A extensão e o servidor Flask funcionam sozinhos após o download. Para rodar também o painel
React/Convex, crie um deployment Convex próprio e configure `CONVEX_DEPLOYMENT`,
`VITE_CONVEX_URL` e as chaves de autenticação exigidas pelo template (as credenciais do
ambiente de prévia não acompanham o ZIP).

---

## 1. Como está organizado

```
projeto/
  extensao/                 Extensão para Chrome e Edge (MV3, JavaScript puro)
    manifest.json
    detectores.js           Motor local (CPF/CNPJ, tokens, senhas, cartões, código…)
    content.js              Leitura do campo, aviso em Shadow DOM, colagem e anexos
    background.js           Service worker, envio direto e cache de regras
    offscreen.html / .js    OCR de prints e extração de texto de PDF, tudo local
    vendor/                 Tesseract.js, pdf.js e dados de idioma empacotados
    popup.html / popup.js
    options.html / options.js
    estilos.css

  servidor/                 Flask + banco (SQLite local, Postgres na nuvem)
    app.py                  Rotas públicas, login, API admin, relatórios, CSV e PDF
    db.py                   Esquema, seed da matriz, admin e código de instalação
    pdf.py                  Gerador de PDF sem dependências (tabela de alertas)
    requirements.txt
    test_app.py             Testes com o Flask test client
    templates/              base.html, landing.html, login.html, painel.html
    static/                 painel.css, painel.js, landing.css, landing.js, detectores.js

  src/                      Painel web (Vite + React 19 + Convex)
    convex/                 schema, seed, painel (API e relatórios)
    lib/                    detectores.ts, matriz de risco e utilitários
    pages/                  Landing, Auth, Dashboard
    components/painel/      Seções do painel, banner, gráficos SVG

  tests/
    detectores.test.ts      testes do motor (Bun)
    extensao.test.mjs       testes do motor da extensão (Node)

  render.yaml               Publicação do servidor na Render (nuvem)
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
> (`servidor/` + `extensao/`) é autocontida para rodar na própria máquina: Flask, SQLite,
> JavaScript e fontes do sistema. Na nuvem, só o banco fica em um Postgres externo gratuito.

Rotas:

- `/` — landing com demonstração ao vivo da análise.
- `/auth` — login por e-mail ou convidado (`returnTo` preservado).
- `/dashboard` — visão geral, regras, áreas, mensagens, auditoria e laboratório.

No servidor Flask (`localhost:5000`), a página inicial também é pública e o botão
**Entrar** leva ao formulário de login:

- `/` — landing, com demonstração local e a matriz de risco carregada do banco.
- `/login` — formulário de acesso.
- `/painel` — painel administrativo (exige sessão).

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
$env:SENTINELA_ADMIN_USUARIO = "admin"
$env:SENTINELA_ADMIN_SENHA   = "uma-senha-forte"
$env:SENTINELA_SECRET_KEY    = "outra-chave-aleatoria"
python app.py
```

Abra **http://localhost:5000** e entre com o usuário/senha definidos acima. Sem variáveis
de ambiente, o servidor usa valores de desenvolvimento (`admin` / `admin123`) e avisa no
console — nunca use isso fora do ambiente local de desenvolvimento.

**Quem precisa de código de instalação:** nada, enquanto o servidor estiver na sua própria
máquina. O servidor olha de onde a conexão veio: de `127.0.0.1` (ele mesmo), o alerta é
aceito direto; de qualquer outro endereço — ou seja, publicado na nuvem —, ele exige o
cabeçalho `X-API-Token` com o **código de instalação**. Esse código aparece no painel, em
**06 · Instalação**, e é o mesmo que se cola nas Opções da extensão.

**Onde ficam os dados:** sem a variável `SENTINELA_DB_URL`, o servidor usa um arquivo SQLite
criado sozinho em `servidor/sentinela.db`. Com ela definida para um endereço `postgresql://`,
usa esse Postgres — e as tabelas são criadas no primeiro acesso, sem rodar SQL na mão.
Nos dois casos o banco já nasce com a matriz de risco, as mensagens, o primeiro
administrador e o código de instalação. Para recomeçar do zero no modo local, pare o
servidor e apague o arquivo `.db` (o código de instalação será gerado de novo).

O painel aceita **vários administradores**: cada um entra com o próprio usuário e senha em
**06 · Instalação**, e nenhuma conta pode remover a si mesma nem deixar o painel sem
administrador.

### Testar a API manualmente

```powershell
Invoke-RestMethod http://localhost:5000/api/ping
Invoke-RestMethod http://localhost:5000/api/config
```

Registrar um alerta de exemplo:

```powershell
$corpo = @{
  data_hora        = (Get-Date).ToString("o")
  site             = "chatgpt.com"
  departamento     = "RH"
  colaborador      = "ana.silva"
  nivel_risco      = "alto"
  acao             = "cancelou"
  tipos_detectados = @(
    @{ tipo_detectado = "CPF"; risco = "alto"; area = "RH" }
  )
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri http://localhost:5000/api/alertas -Method Post `
  -ContentType "application/json" -Body $corpo
```

O servidor **recalcula o nível** a partir dos itens recebidos e rejeita corpo inválido.

### Endpoints principais

| Método | Rota | Proteção | Função |
| --- | --- | --- | --- |
| GET | `/api/ping` | pública | teste de conexão (+ versão e se exige código) |
| GET | `/api/config` | código quando pública | regras ativas + mensagens |
| POST | `/api/alertas` | código quando pública | registra alerta (sem texto), com IP de origem |
| GET | `/api/admin/resumo?limiar=30` | sessão | relatórios e gargalos |
| GET | `/api/admin/alertas` | sessão | filtros, paginação e detalhe |
| DELETE | `/api/admin/alertas/<id>` | sessão | remove um alerta |
| POST | `/api/admin/alertas/limpar-idade` | sessão | retenção por dias |
| DELETE | `/api/admin/alertas` | sessão | limpeza total |
| GET | `/api/admin/departamentos` | sessão | departamentos em uso (inclui “Não informado”) |
| GET | `/api/admin/exportar.csv` | sessão | CSV com os filtros atuais |
| GET | `/api/admin/exportar.pdf` | sessão | PDF com os filtros atuais |
| GET | `/api/admin/instalacao` | sessão | endereço, código de instalação e versão |
| POST | `/api/admin/instalacao/renovar-token` | sessão | gera um novo código |
| GET/POST/DELETE | `/api/admin/usuarios[/<id>]` | sessão | contas de administrador |
| PUT | `/api/admin/usuarios/<id>/senha` | sessão | troca de senha |
| GET/POST/PUT/DELETE | `/api/admin/areas[/<id>]` | sessão | CRUD de áreas |
| GET/POST/PUT/DELETE | `/api/admin/regras[/<id>]` | sessão | CRUD de regras |
| GET/PUT | `/api/admin/mensagens[/<nivel>]` | sessão | mensagens educativas |
| GET/PUT | `/api/admin/configuracoes` | sessão | limiar de gargalo |

---

## 4. Instalar a extensão no Chrome e no Edge

A mesma pasta `extensao/` serve para os dois navegadores: ambos usam o mesmo formato de
extensão (Manifest V3) e as mesmas APIs.

### Google Chrome

1. Abra **chrome://extensions**.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta `extensao/`.
4. Fixe a extensão na barra e abra **Opções**.

### Microsoft Edge

1. Abra **edge://extensions**.
2. Ative o **Modo de desenvolvedor** (menu lateral esquerdo).
3. Clique em **Carregar descompactada** e selecione a mesma pasta `extensao/`.
4. Fixe a extensão na barra e abra **Opções** (o restante é idêntico ao Chrome).

### Configuração (igual nos dois)

5. Preencha:
   - **URL do servidor**: já vem preenchida com o endereço do servidor da empresa
     (`https://sentinela-r7ge.onrender.com`). Só troque por `http://localhost:5000` se for
     testar na própria máquina.
   - **Código de instalação**: deixe vazio quando o servidor estiver na sua máquina. Na
     nuvem, cole o código que aparece no painel em **06 · Instalação**.
   - **Departamento**: ex. `RH`.
   - **Colaborador**: opcional (vazio = anônimo).
6. Clique em **Salvar configurações** (o navegador pergunta se a extensão pode acessar o
   endereço do servidor — escolha **Permitir**), depois em **Testar conexão** e em
   **Sincronizar regras agora**.
7. Abra `https://chatgpt.com`, escreva uma mensagem e observe o aviso. O Copilot agora
   responde em `copilot.cloud.microsoft` (o endereço antigo, `copilot.microsoft.com`,
   continua na lista porque ainda redireciona para o novo).

> O Copilot da barra lateral do Edge abre em páginas internas (`edge://`), onde nenhuma
> extensão consegue agir. Use `https://copilot.cloud.microsoft` na aba normal.

A extensão mantém a última configuração sincronizada em `chrome.storage.local` e continua
analisando com esse cache se o servidor estiver desligado. O alerta, porém, vai direto para
o Flask: **não existe fila**. Se o servidor estiver parado, o popup mostra “Alerta não
registrado” e nada fica pendente para depois.

### O que o protótipo 2 acrescenta

- **Aviso menos invasivo:** painel translúcido com `backdrop-filter`, animação de entrada e
  saída, sem bloquear cliques na página. Risco baixo não abre aviso — só é auditado no envio.
- **Colagem em massa:** o evento `paste` é lido antes do site. Blocos acima de 1.200
  caracteres (ou código) ganham a detecção “Colagem de bloco extenso”, sem esperar o debounce.
- **Prints e imagens:** prints colados (Ctrl+V) ou arrastados são lidos por OCR local em uma
  página offscreen da extensão (Tesseract.js com português e inglês). O texto extraído é
  classificado e descartado; a imagem não sai da máquina.
- **PDFs:** arquivos anexados são abertos com pdf.js empacotado na extensão; o texto é
  extraído página por página e analisado pelo mesmo motor.
- **Regras bilíngues:** “senha/password”, “salário/salary”, “contrato/contract” e as demais
  regras de palavra-chave funcionam em português e inglês.
- **Causas comuns de falha de segurança:** nova área com documentos confidenciais, códigos
  de MFA, dumps de banco, listas de clientes, acesso remoto/VPN, relatórios de
  vulnerabilidade e arquivos de ambiente. O motor também reconhece chaves privadas, strings
  de conexão, URLs assinadas, credenciais em URL e blocos `.env`.
- **Sincronia de registro:** cada envio carrega um `evento_id`; o servidor deduplica o mesmo
  evento, então uma repetição imediata não cria linhas repetidas. O alerta também registra a
  `origem` (`texto`, `colagem`, `imagem`, `pdf` ou `anexo`), exibida no painel e no CSV.

### O que a versão 2.1 acrescenta

- **Registro imediato:** o `POST /api/alertas` não exige mais `X-API-Token` — a rota só
  escuta em `127.0.0.1`. Assim que o Flask sobe, o alerta é gravado sem etapa intermediária.
- **Sem fila e sem alarmes:** a fila local de 100 itens, o alarme de 1 minuto e a
  sincronização de 5 minutos saíram. O envio é direto, com uma repetição curta apenas para
  cobrir o instante em que o servidor está iniciando.
- **Gemini e Copilot:** seletores atualizados (incluindo os nomes em português dos botões de
  envio) e busca que atravessa Shadow DOM, onde o Copilot monta o campo.
- **Leitura mais rápida:** além dos eventos do navegador, um vigia compara o texto do campo a
  cada 300 ms. Colar com Ctrl+V aparece quase na hora, e trocar o prompt (apagar e colar
  outro) recalcula o aviso em vez de manter o primeiro.
- **Aviso ligado ao conteúdo atual:** se o colaborador apagar o texto (ou trocar a imagem),
  o aviso e os anexos daquele conteúdo são descartados sem precisar do botão ×. Uma nova
  imagem colada substitui a anterior.

### O que a versão 2.2 acrescenta

- **Copilot no endereço atual:** `copilot.cloud.microsoft` entrou na lista de sites (o antigo
  `copilot.microsoft.com` continua, porque ainda redireciona). Se o aviso não aparecer,
  confira se o site está marcado em **Opções → Monitoramento**.
- **Aviso de risco baixo:** qualquer detecção agora mostra o painel de aviso, inclusive as de
  risco baixo (e-mail, nome de fornecedor). Antes, só médio e alto apareciam — o colaborador
  não via o aviso nesses casos, embora o alerta fosse registrado no envio.
- **Senha falada:** o detector deixou de exigir dois-pontos. “minha senha é 123”, “a senha do
  banco de dados: abc123”, “the admin password is hunter2” e “senha 123” têm o mesmo peso de
  “senha:123”. Falar da senha sem informar valor (“esqueci a senha do sistema”) não gera
  alerta.
- **Exportação em PDF:** ao lado de **Exportar CSV**, o painel ganhou **Exportar PDF**,
  gerado em memória (sem instalar nada) e com os mesmos filtros da tela.
- **Filtro “Não informado”:** o seletor de departamento passou a listar os departamentos que
  aparecem nos alertas, incluindo os envios sem departamento preenchido.
- **Microsoft Edge:** a extensão roda igual no Chrome e no Edge, com instruções de instalação
  para os dois.
- **Servidor na nuvem:** o mesmo Flask pode rodar 24 h com endereço público (Render), com
  código de instalação obrigatório fora da máquina local.
- **IP do colaborador:** cada alerta guarda o IP de origem (resolvido atrás do proxy),
  exibido na tabela, no detalhe, no CSV e no PDF.
- **Vários administradores:** contas com usuário e senha próprios, criadas no painel.

> A primeira leitura de uma imagem carrega o modelo de OCR local (~3 MB) e pode levar alguns
> segundos. Enquanto o anexo está sendo lido, o envio fica bloqueado e o aviso mostra
> “lendo…”.

### O que a versão 2.3 acrescenta

- **Banco externo:** o servidor passou a aceitar um Postgres definido em `SENTINELA_DB_URL`
  (Neon ou Supabase, gratuitos). No plano gratuito da Render não existe disco, e antes os
  alertas eram apagados a cada reinício ou publicação.
- **Tabelas criadas sozinhas:** no primeiro acesso ao banco novo o esquema é criado e a
  matriz de risco seminada. Não é preciso rodar SQL à mão em painel nenhum.
- **SQLite continua:** sem `SENTINELA_DB_URL` o servidor roda com o arquivo local, como
  antes — útil para testar na própria máquina e para os testes automatizados.
- **Painel mostra o banco:** em **06 · Instalação** aparece **Banco de dados: Externo
  (Postgres)** ou **Local (SQLite)**, para conferir se a nuvem está usando o banco certo.
- **Plano gratuito documentado:** `render.yaml` em plano Free, com o passo a passo do banco
  externo e do monitor de 5 minutos (UptimeRobot) que evita a hibernação.
- **Mesma suíte nos dois bancos:** as 24 verificações do servidor passam em SQLite e em
  Postgres 16.

### Fluxo de interceptação

- Enter sem Shift e clique no botão de enviar são capturados na fase de captura, na janela.
- Risco médio ou alto → modal com **Cancelar e revisar** e **Enviar mesmo assim**.
- “Cancelar e revisar” mantém o texto e registra `acao = "cancelou"`.
- “Enviar mesmo assim” registra `acao = "enviou"` **antes** de liberar o envio e tenta
  reenviar o clique original.
- Risco baixo sem detecções → nenhum alerta é criado.
- Risco baixo com detecções (ex.: nome de fornecedor) → alerta `enviou` registrado no
  momento do envio, antes de a página limpar o campo.

> Em alguns sites o evento sintético usado para reenviar a mensagem pode ser ignorado. Se
> isso acontecer, o texto continua no campo: basta pressionar Enter novamente.

---

## 5. Publicar na nuvem (Render)

Objetivo: o servidor fica ligado, com um endereço público. As extensões de todos os
computadores apontam para ele e os administradores entram no mesmo painel pela web.

Nada precisa rodar na sua máquina: nem Python, nem banco local.

O plano gratuito da Render **não tem disco**. Todo arquivo gravado dentro do servidor (como
um banco SQLite) é apagado a cada publicação ou reinício. Por isso a arquitetura é dividida
em três peças, todas gratuitas:

| Peça | Serviço | Para que serve |
| --- | --- | --- |
| Servidor | Render, plano Free | roda o painel e recebe os alertas |
| Banco | Postgres externo (Neon ou Supabase) | guarda alertas, regras, mensagens e administradores |
| Despertador | UptimeRobot | acessa o servidor a cada 5 minutos para ele não hibernar |

### 1. Criar o banco externo

O servidor funciona igual nos dois serviços. Escolha um:

**Neon** (<https://neon.com>) — recomendado

- Plano Free com 1 GB de dados. Quando ninguém usa, o banco desliga e **acorda sozinho** na
  próxima consulta: não é preciso clicar em nada.
- No painel do Neon, crie o projeto e copie a *connection string* que começa com
  `postgresql://` (prefira o endereço com `-pooler`, feito para muitas conexões curtas).

**Supabase** (<https://supabase.com>)

- Plano Free com 500 MB de dados.
- Atenção: um projeto sem uso por cerca de **uma semana** é pausado e precisa ser reativado
  à mão no painel (**Resume project**). Os dados não são perdidos.
- Em **Connect**, copie a string do *pooler* (porta 6543), que já vem com `sslmode=require`.

Em qualquer um dos dois, guarde a string inteira (usuário, senha, servidor e nome do banco).
Ela é a chave do banco: não compartilhe e não cole em conversa.

Se a senha do banco tiver `@`, `#`, `%` ou `/`, ela precisa vir codificada na string (`@`
vira `%40`, `#` vira `%23`). Copiar direto do botão de copiar do painel evita esse problema.

### 2. Publicar na Render

1. No GitHub, crie um repositório e envie o conteúdo do projeto. O `render.yaml` precisa
   ficar na **raiz** do repositório.
2. Em <https://render.com>, escolha **New → Blueprint** e aponte para o repositório. O
   `render.yaml` já traz plano Free, comando de instalação e de início.
3. A Render pede dois valores:
   - `SENTINELA_ADMIN_SENHA` — a sua senha do painel (8 caracteres ou mais);
   - `SENTINELA_DB_URL` — a string do banco criada no passo 1.
   A `SENTINELA_SECRET_KEY` é gerada automaticamente.
   Se o serviço já existir, essas duas variáveis podem ser adicionadas depois em
   **Environment** (a Render reinicia sozinha ao salvar).
4. Clique em **Apply / Deploy**. No primeiro acesso o servidor cria as tabelas sozinho:
   não há SQL para rodar à mão.
5. Abra `https://<nome>.onrender.com/painel`, entre com o usuário `admin` e a senha do passo
   3. Em **06 · Instalação**, confira se aparece **Banco de dados: Externo (Postgres)** — é a
   confirmação de que o banco da nuvem está conectado — e copie o endereço e o código.

### 3. Impedir que o servidor durma (UptimeRobot)

A Render hiberna o serviço Free depois de **15 minutos sem visitas**. A primeira visita
depois disso demora perto de um minuto, e um alerta enviado nesse intervalo pode se perder.

1. Crie a conta em <https://uptimerobot.com> (plano Free: 50 monitores, checagem a cada
   5 minutos).
2. **Add New Monitor** → tipo **HTTP(s)**.
3. URL: `https://<nome>.onrender.com/api/ping`.
4. Intervalo: **5 minutes**. Salve.

O `/api/ping` responde `{"ok": true, ...}` sem consultar o banco, então serve só para manter
o servidor acordado. Uma ressalva: manter o serviço sempre ligado consome as **750 horas
gratuitas por mês** da Render — o suficiente para um único serviço Free o mês inteiro
(730 h). Se houver outros serviços Free na mesma conta, as horas são divididas entre eles.

### 4. Instalar a extensão nos computadores

O endereço do servidor já vem preenchido de fábrica (`https://sentinela-r7ge.onrender.com`,
definido em `extensao/background.js`). Nas Opções da extensão de cada computador: cole
apenas o **código de instalação**, escolha o departamento e clique em **Salvar** →
**Testar conexão**.

### O que o `render.yaml` já configura

| Item | Valor |
| --- | --- |
| Plano | `free` (sem disco persistente — o banco é externo) |
| Banco | Postgres indicado em `SENTINELA_DB_URL` |
| Processo | `gunicorn app:app --workers 1 --threads 4` |
| Variáveis | `SECRET_KEY` gerada, senha do admin e banco informados por você, cookie seguro; `PORT` vem da Render |

### Cuidados importantes

- **Banco externo é obrigatório no plano Free.** Sem `SENTINELA_DB_URL` o servidor sobe em
  SQLite, avisa no log e perde os alertas a cada reinício.
- **Backup:** os planos gratuitos do Neon e do Supabase não guardam backup automático. De
  vez em quando, exporte os alertas em CSV ou PDF pelo painel.
- **Um único processo** (`--workers 1`): suficiente para uma empresa pequena. Com o banco
  externo, é possível aumentar os processos e usar o endereço de *pooler* do banco.
- **Cookie seguro na nuvem** (`SENTINELA_COOKIE_SEGURO=1`): o painel só funciona por HTTPS,
  que a Render já fornece.
- **Código de instalação:** fora de `127.0.0.1` ele é obrigatório. Pode vir da variável
  `SENTINELA_API_TOKEN` (tem prioridade) ou do banco, gerado no primeiro boot e visível em
  **06 · Instalação**. **Renovar código** invalida as extensões que usam o anterior.
- **IP do colaborador:** a Render entrega o IP real em `X-Forwarded-For`; o `ProxyFix` do
  Flask lê esse valor e o grava no alerta.
- **`python app.py` continua igual:** escuta em `127.0.0.1` e não exige código. Para testar a
  exigência sem nuvem: `SENTINELA_EXIGIR_TOKEN=1 python app.py`.

---

## 6. Roteiro de teste manual

Abra o laboratório do painel (`/dashboard?secao=laboratorio`) ou a extensão e use as frases
abaixo. O laboratório usa as mesmas regras do banco, então alterações em **Regras** mudam o
resultado na hora.

| # | Frase | Resultado esperado | Alerta |
| --- | --- | --- | --- |
| 1 | “Pode revisar a redação deste e-mail de agradecimento?” | Baixo, sem detecções | não criado |
| 2 | “O fornecedor vai atrasar a entrega.” | Baixo — Nome de fornecedor | aviso de risco baixo; alerta criado ao enviar |
| 3 | “O orçamento interno do trimestre é R$ 240.000.” | Médio — Orçamento interno e Valor de despesa | modal de confirmação |
| 4 | “Preciso revisar o cronograma do projeto Atlas.” | Médio — Cronograma de projeto | modal |
| 5 | “O CPF do novo analista é 529.982.247-25.” | Alto — CPF | modal |
| 6 | “O CPF é 529.982.247-24.” | Baixo, sem CPF (dígito inválido) | não criado |
| 7 | “a api_key = sk-proj-8fJ2kLm9Qr4Tz7Xb1Nc6Vd3” | Alto — Token ou chave de API | modal |
| 8 | “O servidor interno é 10.20.30.41.” | Alto — IP ou servidor interno | modal |
| 9 | “Cartão 4111 1111 1111 1111 do cliente.” | Alto — Número de cartão (Luhn) | modal |
| 10 | “function login(user) { return true; }” | Alto — Código-fonte interno | modal |
| 11 | “A cláusula 7 do contrato prevê reajuste.” | Alto — Cláusulas contratuais | modal |
| 12 | “Senha: inverno2026” | Alto — Senha ou credencial | modal |
| 13 | “My password is Hunter2” | Alto — Senha ou credencial (regra bilíngue) | modal |
| 14 | “-----BEGIN RSA PRIVATE KEY-----” | Alto — Chave privada | modal |
| 15 | Um bloco de 2.000 caracteres colado de uma vez | Médio — Colagem de bloco extenso | modal (origem `colagem`) |
| 16 | Print de uma planilha com CPF colado no campo | Alto — CPF, se o OCR reconhecer (origem `imagem`) | modal |
| 17 | “minha senha é 123” | Alto — Senha ou credencial (forma falada) | modal |
| 18 | “a senha do banco de dados: abc123” | Alto — Senha ou credencial | modal |

Depois de cada envio:

1. Confirme que o texto **não** aparece em nenhuma tabela do painel.
2. Abra **Alertas**, clique em **Detalhe** e confira os tipos detectados.
3. Em “Enviou mesmo assim × cancelou”, veja o indicador de letramento do departamento.
4. Crie o terceiro alerta de risco alto no mesmo departamento e confira o bloco de gargalos
   (limiar padrão de 30%).

---

## 7. Testes automatizados

Execute na raiz do projeto:

```powershell
bun test tests/detectores.test.ts
node --test tests/extensao.test.mjs
bun tsc -b --noEmit
```

E, com o venv ativo:

```powershell
cd servidor
python -m unittest test_app.py -v
```

A suíte roda em SQLite por padrão. Para rodar as mesmas verificações contra um Postgres
(é assim que o banco da nuvem é testado antes de publicar):

```bash
# PowerShell: $env:SENTINELA_DB_URL = "postgresql://..."
SENTINELA_DB_URL="postgresql://usuario:senha@servidor/banco" python -m unittest test_app.py -v
```

> Use um banco **de teste**, nunca o de produção: o script apaga e recria o schema `public`
> antes de começar.

### O que foi verificado

- **Servidor Flask:** testes com o `test client`, sem abrir porta: landing pública e
  `/painel` protegido, ping, config com 44 regras bilíngues, alerta aceito sem código na
  máquina local, **alerta recusado sem código quando o pedido vem de fora**, IP gravado,
  validação de entrada, recálculo de risco no servidor, idempotência por `evento_id` e
  `origem`, sessão e logout, página de login e arquivos estáticos, relatórios, gargalo,
  filtros, paginação, detalhe, exclusão, retenção por idade, limpeza total, CSV com BOM,
  **PDF válido com várias páginas**, departamentos em uso, **CRUD de administradores**,
  instalação e renovação do código, CRUD de áreas/regras/mensagens, regex inválida e
  configurações. Resultado: **24/24 passando em SQLite e 24/24 em Postgres 16**, com o mesmo
  código (o banco é escolhido por `SENTINELA_DB_URL`).
- **Detectores do painel (Bun):** CPF/CNPJ válidos e inválidos, Luhn, token, senha, IP
  privado × público, hostname, código-fonte, regras por palavra-chave com acento, regra
  inativa, regex inválida, deduplicação e classificação Alto > Médio > Baixo.
  Resultado: **20/20 passando**.
- **Motor da extensão (Node + vm):** o `detectores.js` real carregado em contexto isolado,
  com 13 testes de CPF, classificação, acentos, token, IP, **senha escrita e falada**, texto
  vazio, regex inválida, regras bilíngues, chave privada, string de conexão, URL assinada,
  bloco `.env`, colagem em massa e mesclagem de detecções. Resultado: **13/13 passando**.
- **Painel web/Convex:** `tsc -b --noEmit` sem erros; o seed sincroniza a matriz expandida
  (6 áreas e 44 regras) em bancos já existentes sem duplicar itens.

### O que não foi possível testar aqui

- **Injeção real nos sites das IAs** (chatgpt.com, Gemini, Claude, Copilot): exige sessão
  autenticada e navegador real; os seletores podem mudar sem aviso.
- **Service worker e chamadas `fetch` da extensão no Chrome** (não há navegador disponível
  neste ambiente). O fluxo foi validado por revisão de código e pela API testada.
- **OCR e extração de PDF reais:** Tesseract.js e pdf.js estão empacotados e a mensagem
  offscreen foi revisada, mas a execução exige uma instância do Chrome com a extensão
  carregada. Vale testar um print, um PDF digital e um PDF escaneado.
- **Conexão real com Neon e Supabase:** o servidor foi verificado contra um Postgres 16
  local; a conexão com o serviço de nuvem depende da sua conta e da string de conexão.
- **Login por e-mail (OTP)** do painel web, pois depende do provedor de e-mail configurado.
- **Aparência visual** em telas reais: o layout foi implementado com breakpoints, mas a
  conferência final de responsividade deve ser feita no navegador.

### Conferência manual recomendada

1. Rodar o Flask e carregar a extensão.
2. Abrir cada uma das cinco IAs e confirmar que o campo é encontrado e o banner aparece
   acima dele.
3. Testar Enter e clique no botão de envio nos dois níveis (médio e alto).
4. Ativar/desativar o monitoramento no popup e confirmar que o banner some.
5. Desligar o Flask, tentar enviar e conferir no popup “Alerta não registrado”; religar e
   confirmar que o próximo alerta aparece no painel na hora, sem fila.
6. Editar uma regra no painel, sincronizar e verificar que o aviso muda.
7. Colar um print (Ctrl+V) e um PDF no campo e conferir o chip de anexo e a `origem` no
   painel.
8. Colar um bloco grande de código e verificar a detecção “Colagem de bloco extenso”.
9. Redimensionar o painel e o popup para conferir o layout mobile.

---

## 8. Limitações conhecidas

- **DOM instável:** os sites de IA trocam seletores com frequência. Todos estão centralizados
  em `SITES` (`extensao/content.js`); quando um campo deixa de ser encontrado, basta ajustar
  a lista. Shadow DOM aberto é atravessado; Shadow DOM fechado e editores em iframes de outra
  origem não são alcançados.
- **Reenvio sintético:** alguns sites ignoram `element.click()`/eventos sintéticos. O aviso
  permanece e o usuário pode enviar manualmente; o alerta já foi registrado.
- **Cobertura de detecção:** a heurística de código e as palavras-chave podem gerar falsos
  positivos/negativos. CPF, CNPJ e cartões são validados por dígitos; os demais tipos são
  padrões textuais.
- **Regex cadastrada no painel** pode ser custosa (ReDoS). O limite de 500 caracteres e o
  acesso restrito reduzem o risco, mas não substituem uma revisão das regras.
- **Código de instalação é a única barreira da extensão:** quem tiver o código consegue
  registrar alertas. Ele não vale para o painel, mas deve ser tratado como senha de serviço e
  renovado quando alguém sai da empresa. Localmente (`127.0.0.1`) o envio continua aberto por
  desenho, para o teste na própria máquina.
- **Flask:** sem bloqueio de conta após tentativas erradas (apenas atraso de 300 ms), sem
  CSRF token explícito nas rotas JSON e **um único processo** de servidor. Adequado a uma
  empresa pequena/média; para escala maior, aumente o número de processos e use o endereço
  de pooler do banco (indicado nos passos abaixo).
- **Painel web:** qualquer conta autenticada é administradora; a semeadura demo é pública e
  idempotente. Em produção, seria necessário vincular papéis (RH/Gestor) e proteger a
  semeadura.
- **Retenção e exportação** têm limites de segurança: 1.000 alertas por execução no Convex,
  2.000 na exportação do Convex e 5.000 no CSV do Flask.
- **Fuso horário:** a extensão envia ISO com fuso; Flask normaliza para o horário local.
  Filtros por data usam o dia local.
- **Sem Chrome Web Store:** a instalação é manual, em modo de desenvolvedor, como pedido.
- **OCR:** o reconhecimento é local e pode errar em imagens de baixa resolução, fontes
  decorativas ou capturas muito longas. O primeiro uso carrega o modelo (~3 MB) e leva
  alguns segundos; o limite por arquivo é de 6 MB.
- **PDF escaneado:** a extração usa a camada de texto do PDF. Um documento digitalizado
  sem OCR embutido precisa ser salvo como imagem e colado como print.
- **Nenhum conteúdo é recuperável:** por decisão de projeto, não existe cópia do texto
  enviado. A auditoria mostra o risco e os tipos, não a conversa.

---

## 9. Segurança implementada

- Senha do admin com `werkzeug.security` (hash) e sessão Flask com cookie `HttpOnly`,
  `SameSite=Lax` e expiração de 8 horas.
- A extensão só entra no servidor com o código de instalação quando o servidor está fora da
  máquina local; o painel continua protegido por sessão e senha com hash.
- Contas de administrador são criadas no painel com senha de pelo menos 8 caracteres; nenhuma
  conta remove a si mesma nem deixa o sistema sem administrador.
- O código de instalação pode ser renovado a qualquer momento, invalidando as extensões
  antigas.
- Todas as consultas SQL são parametrizadas; nenhuma concatenação de valores.
- Validação de entrada (tamanho, enums de risco/tipo/ação, regex compilada) e recálculo do
  nível de risco no servidor.
- Painel Flask renderiza dados com `textContent` (sem `innerHTML`) e templates Jinja
  escapados; cabeçalhos `CSP`, `X-Frame-Options`, `nosniff` e `Referrer-Policy`.
- O texto digitado não faz parte do payload em nenhum ponto do sistema.

---

## 10. Créditos

“Painel de Governança, Auditoria e Letramento em IA”. Implementação com Chrome
Manifest V3, Flask, Postgres/SQLite e React/Convex. Tema visual: minimalismo, paleta quase
monocromática, tipografia serifada para títulos e divisórias finas.
