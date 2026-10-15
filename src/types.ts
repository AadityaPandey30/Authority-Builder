export interface ContentPillar {
  /** Stable slug, e.g. "positioning". */
  id: string;
  /** Human label used in the generated post. */
  name: string;
  /** One-line steer handed to the model. */
  guidance: string;
}

export interface Playbook {
  /** Raw markdown of catalygn.md, echoed back into the system prompt. */
  raw: string;
  /** Pillars parsed out of the playbook; empty when none could be parsed. */
  pillars: ContentPillar[];
  /** Contact number readers are asked to DM, if the playbook states one. */
  contactPhone?: string;
  /** Brand voice / rules section, if the playbook defines one. */
  voiceNotes?: string;
}

export interface CatalogImage {
  url: string;
  /** Pillar ids this image suits. Empty means usable for any pillar. */
  pillars: string[];
  alt?: string;
}

export interface GeneratedPost {
  hook: string;
  body: string;
  cta: string;
  pillarId: string;
  topic: string;
  /** Full WhatsApp caption: hook + body + CTA + DM number. */
  caption: string;
  imageUrl: string;
  model: string;
}

/** Payload sent to the whatsapp-service POST /send (see its README). */
export interface WhatsAppSendPayload {
  agencyId: string;
  clientId: string;
  phone: string;
  imageUrl: string;
  caption: string;
}

export interface WhatsAppSendResult {
  ok: boolean;
  status: number;
  body: unknown;
}
