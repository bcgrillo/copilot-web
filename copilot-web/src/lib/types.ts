export type ChatRole = "user" | "assistant";

export type ToolStep = {
  id?: string;
  title: string;
  status: string;
  /** salida del comando/tool (tool_call_update.content) para el desplegable */
  detail?: string;
};

/** Timeline ordenado de un turno: tramos de texto y tool calls intercalados */
export type MessagePart =
  | { kind: "text"; content: string; reasoning?: string }
  | { kind: "reasoning"; content: string }
  | { kind: "tool"; toolCallId?: string; title: string; status: string; detail?: string }
  | { kind: "system"; content: string };

/** Turno en vivo (solo cliente) mientras llega el stream */
export type LiveTurn = {
  reasoning: string;
  parts: MessagePart[];
  /** prompt que inició el turno (para plegar salidas de comandos slash) */
  userPrompt?: string;
  /** solicitudes de permiso pendientes (cards sobre el composer) */
  permissions?: PermissionReq[];
};

/** Solicitud de permiso del agente, pendiente de respuesta desde la web */
export type PermissionReq = {
  reqId: number;
  title: string;
  toolCallId?: string;
  /** opciones que ofrece el agente (spec ACP): el UI pinta cada una */
  options?: PermissionOption[];
};

/** Opción de un permiso (spec ACP PermissionOptionKind) */
export type PermissionOption = {
  optionId: string;
  kind: string;
  name?: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  reasoning?: string;
  tools?: ToolStep[];
  parts?: MessagePart[];
  /** hora de llegada sellada en la cache RAM del server SOLO para updates
   * en vivo; el replay frío de session/load no la tiene (ACP no la da) */
  ts?: string;
};

/** Comando slash del agente (snapshot available_commands_update de ACP). */
export type AvailableCommand = {
  name: string;
  description?: string;
  input?: { hint?: string } | null;
};

export type SessionSummary = {
  id: string;
  name: string;
  createdAt: string;
  /** cwd de la sesión (session/list del CLI o overlay web) */
  cwd?: string;
  /** última actividad (overlay web o session/list del CLI); base del orden */
  updatedAt?: string;
  /**
   * contenido bajo demanda: SOLO lo rellena GET /api/sessions/:id
   * (materialización del canal ACP en el server). El listado es
   * solo-metadatos.
   */
  messages?: ChatMessage[];
};

export type Attachment = {
  name: string;
  /** contenido en base64 */
  content: string;
};