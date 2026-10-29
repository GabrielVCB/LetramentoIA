"""
Este é o começo do projeto: as regras de risco guardadas em uma lista.

Cada regra é um dicionário com id, nome, área, tipo, padrão, risco e ativo.
As quatro funções abaixo são tudo o que o projeto precisa para criar, ler,
editar e excluir regras.

O resto do sistema é a forma de publicar estas regras:

    regras.py  chama criar() uma vez para cada regra do projeto (o conteúdo)
    db.py      copia a lista para o banco Postgres, na nuvem
    app.py     serve o painel administrativo e a API que a extensão consulta
    extensao/  aplica as regras no texto digitado no navegador

Se uma regra mudar em regras.py, o banco é atualizado na próxima inicialização
do servidor (a versão fica guardada em VERSAO_MATRIZ, em db.py).
"""

# A lista onde tudo fica guardado enquanto o programa está rodando.
REGRAS = []


def listar():
    """LÊ: devolve todas as regras."""
    return REGRAS


def criar(nome, area, tipo, padrao, risco, ativo=True):
    """CRIA: monta uma regra com um id novo e guarda na lista."""
    proximo_id = max([regra["id"] for regra in REGRAS], default=0) + 1
    regra = {
        "id": proximo_id,
        "nome": nome,
        "area": area,
        "tipo": tipo,
        "padrao": padrao,
        "risco": risco,
        "ativo": ativo,
    }
    REGRAS.append(regra)
    return regra


def atualizar(id, nome, area, tipo, padrao, risco, ativo=True):
    """ATUALIZA: procura a regra pelo id e troca os dados dela."""
    for regra in REGRAS:
        if regra["id"] == id:
            regra["nome"] = nome
            regra["area"] = area
            regra["tipo"] = tipo
            regra["padrao"] = padrao
            regra["risco"] = risco
            regra["ativo"] = ativo
            return regra
    return None


def excluir(id):
    """EXCLUI: remove a regra com aquele id. Devolve True se encontrou."""
    for regra in REGRAS:
        if regra["id"] == id:
            REGRAS.remove(regra)
            return True
    return False
