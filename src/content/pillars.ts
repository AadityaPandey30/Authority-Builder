/**
 * Built-in fallback pillars. Used only when catalygn.md does not declare any
 * parseable pillars, so the service never runs without a content plan.
 */
import type { ContentPillar } from '../types';

export const DEFAULT_PILLARS: ContentPillar[] = [
  {
    id: 'positioning',
    name: 'Positioning & Differentiation',
    guidance:
      'Why a business that serves a narrow, specific audience out-earns a generalist, and how to choose that niche.',
  },
  {
    id: 'pricing',
    name: 'Pricing & Profitability',
    guidance:
      'Pricing on value delivered rather than hours, protecting margin, and the operational signals that show you are underpriced.',
  },
  {
    id: 'sales',
    name: 'Sales & Client Acquisition',
    guidance:
      'Consultative selling, qualification, follow-up discipline, and why most inbound leads are lost to slow response rather than price.',
  },
  {
    id: 'operations',
    name: 'Operations & Systems',
    guidance:
      'Turning founder-dependent delivery into documented systems: SOPs, delegation, quality control, and capacity planning.',
  },
  {
    id: 'leadership',
    name: 'Leadership & Team',
    guidance:
      'Hiring for the constraint, running effective meetings, giving feedback that changes behaviour, and building accountability without micromanagement.',
  },
  {
    id: 'growth',
    name: 'Growth & Strategy',
    guidance:
      'Choosing between marketing channels, sequencing growth bets, and diagnosing why revenue plateaus at a certain level.',
  },
];
