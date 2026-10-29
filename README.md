# Sentinela — Governança e Letramento em IA

Painel de governança e letramento em IA. O objetivo é reduzir o vazamento de informações
corporativas para IAs públicas (ChatGPT, Gemini, Claude e Copilot) por falta de letramento,
sem vigiar o conteúdo das conversas.

A extensão lê o campo de texto no navegador do colaborador, avisa antes do envio e registra
apenas o alerta no painel. O texto nunca é enviado nem guardado: o alerta tem site,
departamento, colaborador (opcional), IP de origem, nível de risco, tipos detectados e a
decisão (`enviou` ou `cancelou`).

**Versão atual: 2.6** — servidor e extensão. A mesma versão aparece no painel, em
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

Como a lista existe só enquanto o servidor está rodando, o banco é a cópia que sobrevive ao
reinício. Daí vêm três consequências:

- editar `regras.py` só chega ao banco na próxima inicialização do servidor;
- uma regra criada ou editada no painel não é sobrescrita por esse processo;
- uma regra **excluída** no painel volta na próxima inicialização, porque a semeadura repõe
toda regra de `regras.py` que estiver faltando. Para remover de vez, ela sai do `regras.py`
e do painel.

A versão da semeadura fica em `VERSAO_MATRIZ`, em `db.py`. Quando o número muda, a
inicialização também reaplica `tipo`, `padrao` e `risco` das regras que já existem no banco;
quando continua o mesmo, só entram as regras novas. É isso que impede um deploy de desfazer o
que foi ajustado no painel.

## O que o sistema faz hoje

- **Análise no navegador:** texto digitado, colagem (Ctrl+V), prints/imagens (OCR local) e
  PDFs anexados são analisados pela extensão. Nada disso sai da máquina.
- **Aviso antes do envio:** o painel do aviso mostra o nível de risco e os tipos detectados.
  Risco alto pede confirmação antes de enviar.
- **Regras editáveis:** CRUD de áreas, regras e mensagens educativas no painel. A extensão
  sincroniza a matriz a cada cinco minutos e continua funcionando com a última cópia em cache.
- **Auditoria sem conteúdo:** cada alerta registra site, departamento, colaborador, IP de
  origem, nível, tipos, origem do conteúdo (`texto`, `colagem`, `imagem`, `pdf`, `anexo`) e a
  decisão do colaborador.
- **Relatórios de letramento:** comparação entre envios e cancelamentos por departamento, com
  limiar de gargalo configurável e filtro de departamento (inclui “Não informado”).
- **Exportação:** CSV e PDF, com os mesmos filtros da tela.
- **Chrome e Microsoft Edge:** a mesma extensão roda nos dois navegadores.
- **Departamento em lista:** as Opções da extensão mostram apenas as áreas cadastradas no
  painel, para não gravar um departamento que não existe. “Não informado” é uma opção.
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

O ZIP com todo o código-fonte sai do botão **Baixar projeto (.zip)** — na página inicial ou no
rodapé do painel. Descompacte e guarde a pasta `extensao/`.

**Google Chrome**

1. Abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta `extensao/`.
4. Abra **Opções** da extensão.

**Microsoft Edge**

1. Abra `edge://extensions`.
2. Ligue o **Modo de desenvolvedor**.
3. Clique em **Carregar descompactada** e escolha a mesma pasta `extensao/`.
4. Abra **Opções** da extensão.

**Configurar em Opções (igual nos dois)**

5. **URL do servidor:** já vem preenchida com o endereço do servidor da empresa.
6. **Código de instalação:** copie em **06 · Instalação** e cole nas Opções. Ele não dá acesso
   ao painel: só autoriza a extensão a registrar alertas. Sem o código, o envio é recusado.
7. **Departamento:** escolha na lista (as mesmas áreas do painel) ou deixe “Não informado”.
   **Colaborador** é opcional; vazio = anônimo.
8. Clique em **Salvar configurações**, autorize o acesso ao endereço do servidor quando o
   navegador perguntar, e use **Testar conexão** e **Sincronizar regras agora**.
9. Abra `https://chatgpt.com` (ou Gemini, Claude, Copilot) e digite algo com risco para ver o
   aviso.

A versão instalada aparece na própria página de extensões do navegador, ao lado do nome
Sentinela.

## Painel: só para administradores

O painel é a área da empresa, não do colaborador: **o acesso é restrito a administradores**,
com usuário e senha criados na seção **06 · Instalação**. É possível cadastrar vários
administradores, cada um com o seu login, e trocar senhas por lá.

O colaborador não faz login em lugar nenhum. Ele só tem a extensão instalada, com o
departamento escolhido e o código de instalação colado uma vez nas Opções.

Os horários aparecem no relógio de quem abre o painel: o banco guarda em UTC e o navegador
converte para o fuso da máquina, então um alerta das 14h em Brasília é exibido às 14h em
qualquer computador que esteja no mesmo fuso.
