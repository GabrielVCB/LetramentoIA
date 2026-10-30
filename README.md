# Sentinela — Governança e Letramento em IA

Painel de governança e letramento em IA. O objetivo é reduzir o vazamento de informações
corporativas para IAs públicas (ChatGPT, Gemini, Claude e Copilot) por falta de letramento,
sem vigiar o conteúdo das conversas.

A extensão lê o campo de texto no navegador do colaborador, avisa antes do envio e registra
apenas o alerta no painel. O texto nunca é enviado nem guardado: o alerta tem site,
departamento, colaborador, IP de origem, nível de risco, tipos detectados e a
decisão (`enviou` ou `cancelou`).

**Versão atual: 2.7** — servidor e extensão. A mesma versão aparece no painel, em
**06 · Instalação**.

## Como está organizado

O projeto tem quatro partes, e todas giram em volta de uma só ideia: **as regras de risco**.

```
crud.py     as quatro funções do CRUD, em Python 
regras.py   a matriz: chama criar() uma vez para cada regra
db.py       grava essas regras no banco Postgres
app.py      serve o painel e a API que a extensão consulta
painel      mostra e edita as regras, com login de administrador
extensao/   aplica a cópia das regras no que o colaborador digita
```

| Pasta / arquivo | O que é |
| --- | --- |
| `servidor/crud.py` | CRUD em Python: cria, lista, edita e exclui regras. |
| `servidor/regras.py` | A matriz de risco: as 44 chamadas de `criar()`, agrupadas por área. |
| `servidor/db.py` | Copia as regras de `regras.py` para o Postgres e guarda alertas, áreas, mensagens e administradores. |
| `servidor/app.py` | Servidor Flask: landing, login, API da extensão e API administrativa. |
| `servidor/templates/` e `servidor/static/` | Landing, login e painel administrativo (HTML, CSS e JS puros). |
| `servidor/pdf.py` | Gera o PDF da exportação de alertas, em memória. |
| `extensao/` | Extensão Manifest V3 para Chrome e Microsoft Edge. |
| `render.yaml` | Descrição do serviço web publicado na Render. |
| `src/` | Prévia web do painel (React + Convex), usada para visualizar o projeto no navegador. |

O painel do produto é o Flask, em `servidor/templates/painel.html`. O app em `src/` é uma
prévia visual, com os mesmos dados de exemplo, e não participa do registro de alertas.

## crud.py e regras.py

Todo o sistema parte de uma lista de regras. O CRUD fica em `servidor/crud.py`, em
Python, com quatro funções:

```python
criar(nome, area, tipo, padrao, risco)   # CRIA
listar()                                 # LÊ
atualizar(id, nome, area, tipo, padrao, risco)   # ATUALIZA
excluir(id)                              # EXCLUI
```

Cada regra é um dicionário com `id`, `nome`, `area`, `tipo`, `padrao`, `risco` e `ativo`.
A lista `REGRAS` guarda tudo na memória enquanto o programa está rodando — não há classe,
banco nem JSON nesse arquivo.

A matriz em si fica em `servidor/regras.py`, que só chama `criar()` uma vez para cada uma
das 44 regras, separadas por área. Exemplo de uma regra de verdade:

```python
crud.criar("CPF", "RH", "regex", r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b", "alto")
```

Cada regra diz **o que procurar** (`padrao`), **em qual área** (`area`), **como procurar**
(`tipo`, `regex` ou `palavra-chave`) e **qual a gravidade** (`risco`: `baixo`, `medio` ou
`alto`). As regras de palavra-chave são bilíngues (“senha” e “password” acionam a mesma
regra) e a busca ignora acentos e letras maiúsculas.

O caminho até o uso real é curto:

1. importar `regras.py` executa as 44 chamadas `criar()` e enche a lista `REGRAS`;
2. quando o servidor sobe, `db.py` copia essa lista para as tabelas `areas` e `regras`;
3. `app.py` entrega as regras para a extensão em `/api/config` e mostra a matriz no painel;
4. a extensão sincroniza essa cópia a cada cinco minutos e classifica o texto digitado.

O painel usa exatamente as mesmas quatro funções. Criar, editar ou excluir uma regra em
**04 · Regras** chama `criar()`, `atualizar()` ou `excluir()` do `crud.py`, e a mesma operação
é gravada no banco: a lista em memória e a tabela `regras` nunca divergem.

| Ação no painel | Função do `crud.py` |
| --- | --- |
| cadastrar uma regra | `criar()` |
| ver a matriz de risco | `listar()`, que alimentou o banco na inicialização |
| salvar uma edição | `atualizar()` |
| remover uma regra | `excluir()` |

### Onde cada função é chamada

As quatro funções têm um ponto de chamada no caminho que o sistema percorre de verdade — não
existe lista de regras em outro lugar do projeto.

| Função | Chamada em | Quando acontece |
| --- | --- | --- |
| `criar()` | `regras.py`, 44 vezes | ao importar a matriz, na subida do servidor |
| `criar()` | `db.criar_na_memoria()`, pela rota `POST /api/admin/regras` | ao cadastrar uma regra no painel |
| `listar()` | `db._semear_matriz()` | na subida do servidor, para copiar a matriz para o Postgres |
| `listar()` | `db.regra_em_memoria()`, usada pela edição e pela exclusão | para achar a regra que o painel está alterando |
| `atualizar()` | `db.atualizar_na_memoria()`, pela rota `PUT /api/admin/regras/<id>` | ao salvar uma edição no painel |
| `excluir()` | `db.excluir_da_memoria()`, pela rota `DELETE /api/admin/regras/<id>` | ao remover uma regra no painel |

O caminho de uma edição, por exemplo, não tem atalho: o painel envia o formulário para
`PUT /api/admin/regras/<id>`; a rota grava no banco e chama `db.atualizar_na_memoria()`; essa
função procura a regra com `listar()` e altera com `atualizar()`. Cadastro e exclusão seguem o
mesmo desenho, com `criar()` e `excluir()`.

### Os parâmetros

`criar()` e `atualizar()` recebem os mesmos dados de uma regra:

| Parâmetro | O que é | Exemplo |
| --- | --- | --- |
| `nome` | como a regra aparece no painel | `"CPF"`, `"Salário"` |
| `area` | nome do departamento, em texto | `"RH"`, `"TI"` |
| `tipo` | como o padrão é aplicado | `"regex"` ou `"palavra-chave"` |
| `padrao` | o que a regra procura | `r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"` ou `"senha, password"` |
| `risco` | gravidade do achado | `"baixo"`, `"medio"`, `"alto"` |
| `ativo` | nasce ligada ou desligada | `True` (quando não vem, é `True`) |

A área é texto, não o número do banco, porque a lista é Python puro e não conhece tabelas. A
ponte em `db.py` converte o id escolhido no painel para o nome da área antes de chamar a
função.

O `id` aparece em `atualizar()` e `excluir()` e é o número da regra **dentro da lista**, não o
número do banco: as duas numerações são independentes. Por isso a ligação entre a lista e a
tabela é feita pelo par **nome + área**, que é o que `regra_em_memoria()` procura.

Os retornos completam a prova: `criar()` calcula o `id` sozinho (o maior existente mais um) e
devolve a regra pronta; `atualizar()` devolve a regra alterada ou `None`; `excluir()` devolve
`True` ou `False`; `listar()` devolve a própria lista, então o que as outras três mudam
aparece nela na hora.

Para conferir que a matriz vem mesmo daí, a conta é direta: rodando de dentro de `servidor/`,
`import regras, crud; print(len(crud.listar()))` devolve **44**, o mesmo número de chamadas de
`criar()` em `regras.py`. Cadastre uma regra no painel e a contagem vai a 45; exclua e volta a
44.

## O que o sistema faz hoje

- **Análise no navegador:** texto digitado, colagem (Ctrl+V), prints/imagens (OCR local) e
  PDFs anexados são analisados pela extensão. Nada disso sai da máquina.
- **Aviso antes do envio:** o painel do aviso mostra o nível de risco e os tipos detectados,
  inclusive quando o resultado é risco baixo. Risco alto pede confirmação antes de enviar.
- **Monitoramento com interruptor:** ligar o monitoramento marca todas as IAs; desligar
  desmarca todas e encerra o aviso e a confirmação de envio na hora.
- **Regras editáveis:** CRUD de áreas, regras e mensagens educativas no painel. A extensão
  sincroniza a matriz a cada cinco minutos e continua funcionando com a última cópia em cache.
- **Auditoria sem conteúdo:** cada alerta registra site, departamento, colaborador, IP de
  origem, nível, tipos, origem do conteúdo (`texto`, `colagem`, `imagem`, `pdf`, `anexo`) e a
  decisão do colaborador.
- **Relatórios de letramento:** comparação entre envios e cancelamentos por departamento, com
  tolerância de risco configurável e filtro de departamento (inclui “Não informado”).
  Departamento que atinge a tolerância aparece marcado como **crítico**.
- **Exportação:** CSV e PDF, com os mesmos filtros da tela.
- **Chrome e Microsoft Edge:** a mesma extensão roda nos dois navegadores.
- **Departamento em lista:** as Opções da extensão mostram apenas as áreas cadastradas no
  painel, já carregadas ao abrir a tela, para não gravar um departamento que não existe.
- **Identificação obrigatória:** código de instalação, departamento e identificador do
  colaborador são todos obrigatórios. Sem os três, o alerta não é registrado — não há alerta
  anônimo.
- **Código de instalação:** cada extensão precisa do código exibido no painel para registrar
  alertas; sem ele, o servidor recusa o envio e o popup avisa em vez de falhar em silêncio.

## Onde o sistema roda

O servidor Flask fica publicado na **Render**, com um endereço público. O
banco é um Postgres externo da **Neon**, porque o plano gratuito da Render não tem disco
permanente — sem banco externo, os alertas seriam apagados a cada reinício do serviço.

A Render hiberna o serviço depois de um tempo sem acesso, e a primeira visita seguinte demora
alguns segundos para responder. Para evitar isso, o **UptimeRobot** chama `/api/ping` a cada
cinco minutos e mantém o servidor acordado.

As configurações sensíveis (conexão do banco, senha inicial do painel e chave da sessão)
ficam nas variáveis do serviço de hospedagem, não no código. O servidor não inicia sem a
conexão do banco.

## Baixar e instalar a extensão

Para instalar em um computador, basta a pasta `extensao/`:

- **[sentinela-extensao.zip](public/sentinela-extensao.zip)** — a extensão pronta para carregar
  no navegador. No GitHub, use o botão **Download raw file** para baixar o arquivo. Descompacte o arquivo.zip. 

**Google Chrome**

1. Abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor/programador**.
3. Clique em **Carregar sem compactação / expandida** e escolha a pasta `extensao/`.
4. Clique em **Detalhes**.
4. Abra **Opções de extensão**.

**Microsoft Edge**

1. Abra `edge://extensions`.
2. Ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar descompactada / sem pacote** e escolha a mesma pasta `extensao/`.
4. Clique em **Detalhes**.
4. Abra **Opções de extensão**.

**Configurar em Opções (igual nos dois)**

5. **URL do servidor:** já vem preenchida com o endereço do servidor da empresa.
6. **Código de instalação (obrigatório):** copie em **06 · Instalação** e cole nas Opções. Ele
   não dá acesso ao painel: só autoriza a extensão a registrar alertas. Assim que o código é
   digitado, a lista de departamentos carrega sozinha — não é preciso salvar antes.
7. **Departamento (obrigatório):** escolha na lista, que são exatamente as áreas do painel.
8. **Colaborador (obrigatório):** informe o identificador da pessoa que usa aquele computador.
9. Clique em **Salvar configurações** uma única vez, no fim, autorize o acesso ao endereço do
   servidor quando o navegador perguntar, e use **Testar conexão** e **Sincronizar regras agora**.

A versão instalada aparece na própria página de extensões do navegador, ao lado do nome
Sentinela.

## Painel: só para administradores

O painel é a área da empresa, não do colaborador: **o acesso é restrito a administradores**,
com usuário e senha criados na seção **06 · Instalação**. É possível cadastrar vários
administradores, cada um com o seu login. Para trocar uma senha, o administrador logado
precisa confirmar a própria senha atual — a sessão aberta sozinha não autoriza a troca.

O colaborador não faz login em lugar nenhum. Ele só tem a extensão instalada, com o
departamento escolhido e o código de instalação colado uma vez nas Opções.

Os horários aparecem no relógio de quem abre o painel: o banco guarda em UTC e o navegador
converte para o fuso da máquina, então um alerta das 14h em Brasília é exibido às 14h em
qualquer computador que esteja no mesmo fuso.
