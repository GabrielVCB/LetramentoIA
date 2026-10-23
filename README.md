# Sentinela — Governança, Auditoria e Letramento em IA

Painel de governança e letramento em IA. O objetivo é reduzir o vazamento de informações
corporativas para IAs públicas (ChatGPT, Gemini, Claude e Copilot) por falta de letramento,
sem vigiar o conteúdo das conversas.

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

A prévia disponibiliza um ZIP com todo o código-fonte em **`/sentinela-projeto.zip`**:

- No rodapé da página inicial, clique em **Baixar projeto (.zip)**.
- Ou, no painel autenticado, use **Baixar projeto (.zip)** no rodapé do menu lateral.
- Rodando localmente, o endereço é `http://localhost:5173/sentinela-projeto.zip`.

No Windows/PowerShell, descompacte com:

```powershell
Expand-Archive -Path .\sentinela-projeto.zip -DestinationPath .
cd sentinela
```

O ZIP contém `src/`, `extensao/`, `servidor/`, `tests/` e os arquivos de configuração.
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
  extensao/                 Extensão Chrome (MV3, JavaScript puro)
    manifest.json
    detectores.js           Motor local (CPF/CNPJ, tokens, senhas, cartões, código…)
    content.js              Leitura do campo, aviso em Shadow DOM, colagem e anexos
    background.js           Service worker, sync a cada 5 min, fila offline
    offscreen.html / .js    OCR de prints e extração de texto de PDF, tudo local
    vendor/                 Tesseract.js, pdf.js e dados de idioma empacotados
    popup.html / popup.js
    options.html / options.js
    estilos.css

  servidor/                 Flask + SQLite (entrega local)
    app.py                  Rotas públicas, login, API admin, relatórios, CSV
    db.py                   Esquema, seed da matriz e do admin
    requirements.txt
    test_app.py             16 testes com o Flask test client
    templates/              base.html, landing.html, login.html, painel.html
    static/                 painel.css, painel.js, landing.css, landing.js, detectores.js

  src/                      Painel web (Vite + React 19 + Convex)
    convex/                 schema, seed, painel (API e relatórios)
    lib/                    detectores.ts, matriz de risco e utilitários
    pages/                  Landing, Auth, Dashboard
    components/painel/      Seções do painel, banner, gráficos SVG

  tests/
    detectores.test.ts      20 testes do motor (Bun)
    extensao.test.mjs       12 testes do motor da extensão (Node)

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

No servidor Flask (`localhost:5000`), a página inicial também é pública e o botão
**Entrar** leva ao formulário de login:

- `/` — landing, com demonstração local e a matriz de risco carregada do SQLite.
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
$env:SENTINELA_API_TOKEN   = "um-token-longo-e-aleatorio"
$env:SENTINELA_ADMIN_USUARIO = "admin"
$env:SENTINELA_ADMIN_SENHA   = "uma-senha-forte"
$env:SENTINELA_SECRET_KEY    = "outra-chave-aleatoria"
python app.py
```

Abra **http://localhost:5000** e entre com o usuário/senha definidos acima. Sem variáveis
de ambiente, o servidor usa valores de desenvolvimento (`admin` / `admin123` e
`dev-token-sentinela`) e avisa no console — nunca use isso fora do ambiente local de
desenvolvimento.

O SQLite é criado automaticamente em `servidor/sentinela.db`, junto com a matriz de risco,
as mensagens e o usuário administrador. Para recomeçar do zero, pare o servidor e apague
esse arquivo.

### Testar a API manualmente

```powershell
Invoke-RestMethod http://localhost:5000/api/ping
Invoke-RestMethod http://localhost:5000/api/config
```

Registrar um alerta de exemplo:

```powershell
$headers = @{ "X-API-Token" = "um-token-longo-e-aleatorio" }
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
  -Headers $headers -ContentType "application/json" -Body $corpo
```

O servidor **recalcula o nível** a partir dos itens recebidos e rejeita o corpo sem token.

### Endpoints principais

| Método | Rota | Proteção | Função |
| --- | --- | --- | --- |
| GET | `/api/ping` | pública | teste de conexão |
| GET | `/api/config` | pública | regras ativas + mensagens |
| POST | `/api/alertas` | `X-API-Token` | registra alerta (sem texto) |
| GET | `/api/admin/resumo?limiar=30` | sessão | relatórios e gargalos |
| GET | `/api/admin/alertas` | sessão | filtros, paginação e detalhe |
| DELETE | `/api/admin/alertas/<id>` | sessão | remove um alerta |
| POST | `/api/admin/alertas/limpar-idade` | sessão | retenção por dias |
| DELETE | `/api/admin/alertas` | sessão | limpeza total |
| GET | `/api/admin/exportar.csv` | sessão | CSV com os filtros atuais |
| GET/POST/PUT/DELETE | `/api/admin/areas[/<id>]` | sessão | CRUD de áreas |
| GET/POST/PUT/DELETE | `/api/admin/regras[/<id>]` | sessão | CRUD de regras |
| GET/PUT | `/api/admin/mensagens[/<nivel>]` | sessão | mensagens educativas |
| GET/PUT | `/api/admin/configuracoes` | sessão | limiar de gargalo |

---

## 4. Instalar a extensão no Chrome

1. Abra **chrome://extensions**.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta `extensao/`.
4. Fixe a extensão na barra e abra **Opções**.
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
  evento, então o reenvio da fila não cria linhas repetidas. O alerta também registra a
  `origem` (`texto`, `colagem`, `imagem`, `pdf` ou `anexo`), exibida no painel e no CSV.

> A primeira leitura de uma imagem carrega o modelo de OCR local (~3 MB) e pode levar alguns
> segundos. Enquanto o anexo está sendo lido, o envio fica bloqueado e o aviso mostra
> “lendo…”.

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

## 5. Roteiro de teste manual

Abra o laboratório do painel (`/dashboard?secao=laboratorio`) ou a extensão e use as frases
abaixo. O laboratório usa as mesmas regras do banco, então alterações em **Regras** mudam o
resultado na hora.

| # | Frase | Resultado esperado | Alerta |
| --- | --- | --- | --- |
| 1 | “Pode revisar a redação deste e-mail de agradecimento?” | Baixo, sem detecções | não criado |
| 2 | “O fornecedor vai atrasar a entrega.” | Baixo — Nome de fornecedor | criado só ao enviar |
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

Depois de cada envio:

1. Confirme que o texto **não** aparece em nenhuma tabela do painel.
2. Abra **Alertas**, clique em **Detalhe** e confira os tipos detectados.
3. Em “Enviou mesmo assim × cancelou”, veja o indicador de letramento do departamento.
4. Crie o terceiro alerta de risco alto no mesmo departamento e confira o bloco de gargalos
   (limiar padrão de 30%).

---

## 6. Testes automatizados

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

### O que foi verificado

- **Servidor Flask:** 16 testes com o `test client`, sem abrir porta: landing pública e
  `/painel` protegido, ping, config com 44 regras bilíngues, token inválido, validação de
  entrada, recálculo de risco no servidor, idempotência por `evento_id` e `origem`, sessão e
  logout, página de login e arquivos estáticos, relatórios, gargalo, filtros, paginação,
  detalhe, exclusão, retenção por idade, limpeza total, CSV com BOM, CRUD de
  áreas/regras/mensagens, regex inválida e configurações. Resultado: **16/16 passando**.
- **Detectores do painel (Bun):** CPF/CNPJ válidos e inválidos, Luhn, token, senha, IP
  privado × público, hostname, código-fonte, regras por palavra-chave com acento, regra
  inativa, regex inválida, deduplicação e classificação Alto > Médio > Baixo.
  Resultado: **20/20 passando**.
- **Motor da extensão (Node + vm):** o `detectores.js` real carregado em contexto isolado,
  com 12 testes de CPF, classificação, acentos, token, IP, texto vazio, regex inválida,
  regras bilíngues, chave privada, string de conexão, URL assinada, bloco `.env`, colagem em
  massa e mesclagem de detecções. Resultado: **12/12 passando**.
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
- **Login por e-mail (OTP)** do painel web, pois depende do provedor de e-mail configurado.
- **Aparência visual** em telas reais: o layout foi implementado com breakpoints, mas a
  conferência final de responsividade deve ser feita no navegador.

### Conferência manual recomendada

1. Rodar o Flask e carregar a extensão.
2. Abrir cada uma das cinco IAs e confirmar que o campo é encontrado e o banner aparece
   acima dele.
3. Testar Enter e clique no botão de envio nos dois níveis (médio e alto).
4. Ativar/desativar o monitoramento no popup e confirmar que o banner some.
5. Desligar o Flask, enviar um alerta e conferir a fila offline; religar e reenviar (sem
   duplicar o registro — a auditoria deve continuar com uma linha por evento).
6. Editar uma regra no painel, sincronizar e verificar que o aviso muda.
7. Colar um print (Ctrl+V) e um PDF no campo e conferir o chip de anexo e a `origem` no
   painel.
8. Colar um bloco grande de código e verificar a detecção “Colagem de bloco extenso”.
9. Redimensionar o painel e o popup para conferir o layout mobile.

---

## 7. Limitações conhecidas

- **DOM instável:** os sites de IA trocam seletores com frequência. Todos estão centralizados
  em `SITES` (`extensao/content.js`); quando um campo deixa de ser encontrado, basta ajustar
  a lista. Editores dentro de iframes ou Shadow DOM fechado não são alcançados.
- **Reenvio sintético:** alguns sites ignoram `element.click()`/eventos sintéticos. O aviso
  permanece e o usuário pode enviar manualmente; o alerta já foi registrado.
- **Cobertura de detecção:** a heurística de código e as palavras-chave podem gerar falsos
  positivos/negativos. CPF, CNPJ e cartões são validados por dígitos; os demais tipos são
  padrões textuais.
- **Regex cadastrada no painel** pode ser custosa (ReDoS). O limite de 500 caracteres e o
  acesso restrito reduzem o risco, mas não substituem uma revisão das regras.
- **Token no navegador:** `chrome.storage.local` é legível pelo usuário local. Troque o
  token padrão e não reutilize credenciais reais.
- **Flask (demonstração local):** um único administrador, sem bloqueio de conta após tentativas (apenas
  atraso de 300 ms), sem CSRF token explícito nas rotas JSON e SQLite sem concorrência para
  múltiplos usuários. Adequado a demonstração local, não a produção.
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

## 8. Segurança implementada

- Senha do admin com `werkzeug.security` (hash) e sessão Flask com cookie `HttpOnly`,
  `SameSite=Lax` e expiração de 8 horas.
- Token de API comparado com `hmac.compare_digest` no header `X-API-Token`.
- Todas as consultas SQL são parametrizadas; nenhuma concatenação de valores.
- Validação de entrada (tamanho, enums de risco/tipo/ação, regex compilada) e recálculo do
  nível de risco no servidor.
- Painel Flask renderiza dados com `textContent` (sem `innerHTML`) e templates Jinja
  escapados; cabeçalhos `CSP`, `X-Frame-Options`, `nosniff` e `Referrer-Policy`.
- O texto digitado não faz parte do payload em nenhum ponto do sistema.

---

## 9. Créditos

“Painel de Governança, Auditoria e Letramento em IA”. Implementação local com Chrome
Manifest V3, Flask, SQLite e React/Convex. Tema visual: minimalismo, paleta quase
monocromática, tipografia serifada para títulos e divisórias finas.
