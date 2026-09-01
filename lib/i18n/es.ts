import type { TKey } from "./en";

/**
 * ESPAÑOL — dicionário PARCIAL, e isso é uma escolha.
 *
 * ---------------------------------------------------------------------------
 * POR QUE PARCIAL PODE ENTRAR
 *
 * `index.tsx` resolve chave a chave contra o inglês: uma chave que falte aqui
 * mostra a inglesa, e nunca um espaço em branco. É o que torna seguro publicar
 * o espanhol antes de ele estar completo — e é o contrário do que costuma
 * acontecer, em que um idioma incompleto parte a tela e por isso ninguém o
 * publica até estar todo, o que quer dizer nunca.
 *
 * O que está aqui é o que a pessoa vê SEMPRE (o menu, os botões comuns, a
 * entrada) mais as telas mexidas nesta ronda: fecho do período, obrigações,
 * conciliação fiscal, não integrados e o lançamento manual. O resto cai em
 * inglês até alguém o trazer.
 *
 * ---------------------------------------------------------------------------
 * TERMOS FISCAIS FICAM COMO SÃO
 *
 * VAT3, RTD, CT1, B1, Form 11, CRO, Revenue e ROS são nomes próprios de
 * documentos e entidades irlandesas. Traduzi-los ("Declaración VAT3") daria a
 * impressão de existir um documento espanhol equivalente, e quem for procurá-lo
 * no sítio da Revenue não o encontra. Ficam no original.
 * ---------------------------------------------------------------------------
 */

const es: Partial<Record<TKey, string>> = {
  // ------------------------------------------------------------------ menu
  "nav.dashboard": "Panel",
  "nav.clients": "Clientes",
  "nav.analyze": "Analizar",
  "nav.inbox": "Entrada",
  "nav.database": "Base de datos",
  "nav.items": "Artículos",
  "nav.charges": "Cargos y pagos",
  "nav.chart": "Plan de cuentas",
  "nav.rateBase": "Base de tipos",
  "nav.settings": "Configuración",
  "nav.signOut": "Cerrar sesión",
  "nav.collapse": "Contraer",
  "nav.expand": "Expandir",
  "nav.search": "Buscar facturas, artículos, clientes…",
  "nav.newAnalysis": "Nuevo análisis",
  "nav.noClient": "Ningún cliente seleccionado",
  "nav.openClient": "Abrir inicio del cliente →",
  "nav.switchCompany": "Cambiar de empresa ⇄",
  "nav.themeToLight": "Cambiar al tema claro",
  "nav.themeToDark": "Cambiar al tema oscuro",
  "nav.obligations": "Agenda fiscal",

  // ----------------------------------------------------------------- comuns
  "common.save": "Guardar",
  "common.saveChanges": "Guardar cambios",
  "common.saving": "Guardando…",
  "common.cancel": "Cancelar",
  "common.delete": "Eliminar",
  "common.edit": "Editar",
  "common.open": "Abrir",
  "common.close": "Cerrar",
  "common.dismiss": "Descartar",
  "common.clear": "Limpiar",
  "common.search": "Buscar",
  "common.loading": "Cargando…",
  "common.none": "—",
  "common.yes": "Sí",
  "common.no": "No",
  "common.total": "Total",
  "common.actions": "Acciones",
  "common.status": "Estado",
  "common.date": "Fecha",
  "common.from": "Desde",
  "common.to": "Hasta",
  "common.notFound": "No encontrado.",
  "common.back": "Volver",
  "common.add": "Añadir",
  "common.create": "Crear",
  "common.active": "Activo",
  "common.inactive": "Inactivo",
  "common.required": "obligatorio",
  "common.notSaved": "No se guardó.",

  // ---------------------------------------------------------------- entrada
  "login.welcomeBack": "¡Bienvenido de nuevo!",
  "login.title": "Acceda a Accentra ERP",
  "login.subtitle": "Introduzca sus datos para entrar en la plataforma y gestionar sus clientes contables.",
  "login.signIn": "Entrar",
  "login.signingIn": "Entrando…",
  "login.welcome": "Bienvenido de nuevo. Introduzca sus credenciales para continuar.",
  "login.company": "Empresa",
  "login.companyHelp": "Déjelo en blanco si pertenece a una sola empresa.",
  "login.email": "Correo electrónico",
  "login.password": "Contraseña",
  "login.show": "Mostrar",
  "login.hide": "Ocultar",
  "login.remember": "Mantener la sesión iniciada",
  "login.rememberHelp": "Desmárquelo en un ordenador compartido: la sesión terminará al cerrar el navegador.",
  "login.protected": "Área protegida — el acceso está restringido a usuarios autorizados.",
  "login.invalid": "Correo o contraseña incorrectos.",
  "login.licenseExpired": "La licencia de esta empresa ha caducado. Hable con el administrador.",
  "login.companyInactive": "Esta empresa está inactiva. Hable con el administrador.",
  "login.forgotPassword": "¿Olvidó su contraseña?",
  "login.forgotTitle": "Restablecer la contraseña",
  "login.forgotEmail": "Correo de su cuenta",
  "login.forgotSubmit": "Enviar enlace de restablecimiento",
  "login.forgotSending": "Enviando…",
  "login.forgotSent": "Si ese correo está registrado, hemos enviado un enlace de restablecimiento. Revise su bandeja de entrada.",
  "login.forgotCancel": "Volver al inicio de sesión",
  "login.pitchTitle": "La plataforma completa para la gestión contable y financiera.",
  "login.pitchBody": "Lea facturas. Valide el VAT. Gestione clientes, proveedores, bancos, nóminas y obligaciones — todo en un solo lugar.",
  "login.chipAccounting": "Contabilidad",
  "login.chipFinance": "Finanzas",
  "login.chipVat": "VAT",
  "login.chipPayroll": "Nóminas",
  "login.chipBanking": "Bancos",
  "login.trustTitle": "Seguro · Fiable · Conforme",
  "login.trustBody": "Los datos de sus clientes permanecen en su propia instalación.",
  "login.language": "Idioma",

  // ------------------------------------------------------- fecho do período
  "acc.tab_closing": "Cierre",
  "close.checks": "Antes de cerrar",
  "close.allClean": "Nada pendiente — todas las comprobaciones salieron limpias.",
  "close.ok": "limpio",
  "close.impedes": "impide",
  "close.warns": "avisa",
  "close.blocked": "{n} punto(s) todavía cambian las cifras de este mes. Corríjalos y el cierre se abre solo.",
  "close.ready": "Todo comprobado en este mes.",
  "close.readyWithWarnings": "Nada impide el cierre. {n} punto(s) quedan registrados con él, sin explicar.",
  "close.note": "Observación",
  "close.closeBtn": "Cerrar {n}",
  "close.closed": "Mes cerrado. Su libro mayor queda bloqueado.",
  "close.isClosed": "cerrado",
  "close.closedOn": "cerrado el {n}",
  "close.lockedThrough": "bloqueado hasta {n}",
  "close.reopen": "Reabrir este mes",
  "close.reopenReason": "motivo de la reapertura",
  "close.reopenBtn": "Reabrir",
  "close.reopened": "Mes reabierto. El libro mayor vuelve a aceptar asientos.",
  "close.chk_porConferir": "Documentos sin revisar",
  "close.chk_meiasIntegracoes": "Documentos integrados a medias",
  "close.chk_razaoDesbalanceado": "El balance no cuadra",
  "close.chk_vatDivergente": "VAT: documentos frente al libro mayor",
  "close.chk_controloPagar": "Cuenta de control de proveedores",
  "close.chk_controloReceber": "Cuenta de control de clientes",
  "close.chk_bancoPorFechar": "Cuentas bancarias sin cerrar hasta fin de mes",
  "close.chk_mesAnteriorAberto": "El mes anterior sigue abierto",
  "close.m1": "Ene", "close.m2": "Feb", "close.m3": "Mar", "close.m4": "Abr",
  "close.m5": "May", "close.m6": "Jun", "close.m7": "Jul", "close.m8": "Ago",
  "close.m9": "Sep", "close.m10": "Oct", "close.m11": "Nov", "close.m12": "Dic",

  // ----------------------------------------------------------- obrigações
  "obl.colFiled": "Presentada",
  "obl.colPaid": "Pago",
  "obl.filed": "Presentada ✓",
  "obl.markFiled": "Marcar presentada",
  "obl.undoFiled": "Pulse para volver a marcarla como no presentada",
  "obl.paid": "pagada",
  "obl.partial": "pagada en parte",
  "obl.unpaid": "pendiente",
  "obl.noTitle": "todavía no está en cuentas a pagar",
  "obl.seeTitle": "ver",
  "obl.overdue": "vencida",

  // ------------------------------------------------------ conciliação fiscal
  "tax.needsClose": "El período debe estar cerrado primero — mientras está abierto el importe todavía cambia.",
  "tax.taxAccount": "Cuenta del impuesto a pagar",
  "tax.expenseAccount": "Cuenta del gasto",
  "tax.expenseAlreadyPosted": "Ya contabilizado en el cierre — no volver a contabilizar",
  "tax.toPay": "A pagar",
  "tax.toRecover": "A recuperar",
  "tax.refresh": "Actualizar",

  // ------------------------------------------------------- não integrados
  "unposted.integrado_sem_conferir": "Integrado sin revisar — el importe ya cuenta; revíselo o devuélvalo",
  "unposted.missPayable": "está en el libro mayor — falta en cuentas a pagar",
  "unposted.missReceivable": "está en el libro mayor — falta en cuentas a cobrar",
  "unposted.missLedger": "está en la lista — falta en el libro mayor",

  // ---------------------------------------------------- lançamento manual
  "manual.kind": "Tipo de documento",
  "manual.kindNormal": "Normal — el gasto se reconoce ahora",
  "manual.kindTax": "Impuesto — no contabiliza hasta que se pague",
  "manual.suppliers": "proveedores",
  "manual.customers": "clientes",
};

export default es;
