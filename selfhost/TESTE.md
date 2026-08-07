# Roteiro de teste no PC novo

Objetivo: confirmar que dá para entrar, gravar cliente e nota, sair, e que na
volta continua tudo lá.

Marque cada item. Se algum falhar, `node selfhost/scripts/logs.js` mostra o
motivo do lado do banco.

---

## 1. Instalação

- [ ] O instalador terminou com **"Instalacao concluida"** e mostrou o endereço
      e o login.
- [ ] Anotei o endereço que ele mostrou (pode não ser `localhost:3000` se a
      porta estava ocupada).

## 2. Primeira entrada

- [ ] `start.bat` / `start.command` abriu o navegador no endereço certo.
- [ ] Entrei com o e-mail e a senha que digitei na instalação.
- [ ] Caiu no **Dashboard** (não voltou para a tela de login).
- [ ] **Rate base** no menu mostra as alíquotas (23%, 13,5%, 9%, 4,8%, 0%,
      isento) — é a base de referência que veio na instalação.

> Se o login for recusado: a senha é a que você digitou **nesta instalação**, não
> a senha do sistema na nuvem. Rode o instalador de novo para redefini-la.

## 3. Gravar dados novos

- [ ] **Clients → novo cliente**: criei um cliente com nome, código e o objeto
      social (ex.: *Restaurant / catering*).
- [ ] O cliente aparece na lista depois de salvar.
- [ ] **Analyze**: subi uma nota de verdade (PDF ou foto).
- [ ] A leitura trouxe os itens e as alíquotas.
      *(Se não trouxer nada, falta a `GEMINI_API_KEY` em `.env.local`.)*
- [ ] Revisei os itens e **salvei** a nota.
- [ ] A nota aparece na **Database** e o Dashboard atualizou os totais
      (Purchases T2 e Input credit).
- [ ] Abri a nota salva e o **PDF original abre** — isso prova que o
      armazenamento de arquivos está funcionando, não só o banco.

## 4. Sair

- [ ] **Sign out** no menu → voltou para a tela de login.
- [ ] Tentei abrir o endereço de novo: ele exige login (não entra direto).
- [ ] Fechei a janela preta do `start`.
- [ ] Rodei `stop.bat` / `stop.command`.

## 5. Reentrada — o teste que importa

- [ ] Rodei `start.bat` / `start.command` de novo.
- [ ] Entrei com o mesmo login.
- [ ] **O cliente que criei continua lá.**
- [ ] **A nota que salvei continua lá**, com os mesmos totais.
- [ ] O PDF da nota ainda abre.
- [ ] Os números do Dashboard batem com os de antes de sair.

## 6. Prova final (opcional, mas vale fazer)

- [ ] **Reiniciei o computador**, abri o `start` e os dados continuam lá.

Isso separa "sobreviveu ao fechar o app" de "sobreviveu ao desligar a máquina",
que é o cenário real do escritório.

---

## O que já foi verificado antes de te entregar

Este mesmo ciclo foi executado ponta a ponta em 07/08/2026, no Mac, contra o
pacote deste repositório:

| Passo | Resultado |
|---|---|
| Instalação do zero (stack, schema, base, admin, build) | OK |
| Login com a senha definida na instalação | OK |
| Login com senha errada | recusado (401) |
| Criar cliente | OK |
| Salvar nota com 2 itens + PDF anexo | OK — crédito €11,50 (camarão 0%, vinho 23%) |
| Arquivo gravado no storage em disco | OK |
| Sign out e bloqueio de acesso sem sessão | OK |
| Parar app + containers e subir de novo | OK |
| Reentrar: cliente, nota, itens, totais e PDF | tudo preservado |

O que **não** deu para verificar aqui e precisa ser visto no PC de destino:

- Windows de verdade (Docker Desktop + WSL2) — foi validado só no Mac.
- Leitura de uma nota real pelo Gemini (o teste usou uma nota montada à mão).
- Reinício da máquina.
