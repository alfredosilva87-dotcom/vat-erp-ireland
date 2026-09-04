-- AS CONVERSAS COM O CLIENTE, GUARDADAS AO PE DO QUE ELAS PRODUZIRAM.
--
-- ---------------------------------------------------------------------------
-- O PROBLEMA, DITO COMO ELE E
--
-- As horas de varios clientes chegam por WhatsApp, escritas a mao, para o
-- telemovel PESSOAL de quem faz a folha. Isso nao se pode automatizar por via
-- oficial: a Cloud API da Meta so entrega mensagens enviadas para um numero
-- registado na plataforma Business, e um numero pessoal nunca e legivel por ai.
-- Prometer um "motor que vasculha o WhatsApp" seria prometer o que nao existe.
--
-- O que se pode fazer — e e o que falta mesmo — e deixar de perder a mensagem.
-- Hoje ela vive no telemovel de uma pessoa: nao ha registo de quem mandou o
-- que, nem de quando, nem do que se leu dela. Na sexta-feira, a pergunta "quem
-- e que ainda nao mandou as horas?" responde-se de cabeca.
--
-- ---------------------------------------------------------------------------
-- PORQUE A MENSAGEM ORIGINAL FICA INTEIRA
--
-- O texto cru e a unica prova do que a pessoa escreveu. A leitura automatica
-- pode enganar-se — e engana-se, sao frases escritas do telemovel ao domingo a
-- noite — e quem confere tem de poder comparar o que o sistema entendeu com o
-- que la esta. Guardar so o resultado da leitura seria guardar a nossa
-- interpretacao e deitar fora o facto.
--
-- ---------------------------------------------------------------------------
-- ISTO NAO E UM CLIENTE DE WHATSAPP
--
-- Nao envia nem recebe nada sozinho. E o registo do que passou pelo canal, com
-- a leitura ao lado e a ligacao ao que foi para a fila. O envio continua a ser
-- o link `wa.me` que ja existe — abre a conversa no aparelho de quem trabalha,
-- e e uma pessoa que carrega em enviar.

create table if not exists hr_conversation (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients(id) on delete cascade,

  -- 'in'  — o cliente mandou (as horas, uma pergunta, um documento)
  -- 'out' — o escritorio mandou (o pedido das horas, um recado)
  direction   text not null check (direction in ('in','out')),
  channel     text not null default 'whatsapp'
                check (channel in ('whatsapp','email','phone','note')),

  -- O TEXTO COMO ELE VEIO. Nunca se reescreve.
  body        text not null,

  /*
   * A que semana a mensagem diz respeito.
   *
   * Anulavel de proposito: nem toda a mensagem e sobre uma semana ("mandas-me a
   * morada da empresa?"). Forcar um numero aqui obrigaria a inventar um.
   */
  year        integer,
  week_no     integer check (week_no between 1 and 53),

  /*
   * O QUE SE LEU DA MENSAGEM, tal como a leitura o devolveu — linhas e nao
   * lidas. Fica ao lado do original para se poder comparar, e nao no lugar
   * dele.
   */
  parsed      jsonb,
  -- Quantas linhas desta mensagem foram para a fila de horas.
  queued      integer not null default 0,

  created_by  uuid references app_users(id),
  created_at  timestamptz not null default now()
);

-- A pergunta que esta tela responde e sempre "o que ha de novo, e de quem" —
-- por isso o indice e por cliente e por data, do mais recente para tras.
create index if not exists idx_hr_conv_cliente on hr_conversation(client_id, created_at desc);
create index if not exists idx_hr_conv_semana  on hr_conversation(year, week_no);

comment on table hr_conversation is
  'Registo das mensagens trocadas com o cliente sobre a folha. Nao envia nem recebe: guarda.';
comment on column hr_conversation.body is
  'O texto ORIGINAL. E a unica prova do que a pessoa escreveu; a leitura automatica vive em parsed.';
