/** JSON schemas for structured chief output. Kept flat (no oneOf) for broad model compatibility. */
export const ORDER_SCHEMA = {
  type: 'object',
  properties: {
    task: { type: 'string', enum: ['forage', 'hunt', 'fish', 'gather', 'clear', 'farm', 'build', 'craft', 'research', 'road', 'explore', 'colonize', 'envoy', 'raid', 'expedition', 'rest'] },
    workers: { type: 'integer', description: 'adults assigned (0 for colonize)' },
    commodity: { type: 'string', description: 'gather or expedition: what to collect, by name' },
    weeks: { type: 'integer', description: 'expedition: weeks to spend collecting, 1 to 8' },
    recipe: { type: 'string', description: 'build or craft: recipe by name' },
    quantity: { type: 'integer', description: 'craft: units to make before stopping (0 = keep making)' },
    ingredients: { type: 'array', items: { type: 'string' }, description: 'research: one or two ingredient names, optionally one skill name' },
    plots: { type: 'integer', description: 'farm: plots to plant this spring' },
    crop: { type: 'string', description: 'farm: crop name' },
    direction: { type: 'string', description: 'explore: north, northeast, east, ...' },
    days: { type: 'integer', description: 'explore: how many days out' },
    site: { type: 'integer', description: 'colonize: site number from the list' },
    share: { type: 'number', description: 'colonize: fraction of the village to send, 0.2 to 0.6' },
    village: { type: 'string', description: 'envoy or raid: village name' },
    offer: { type: 'object', additionalProperties: { type: 'integer' }, description: 'envoy: goods to carry, name -> units' },
    want: { type: 'object', additionalProperties: { type: 'integer' }, description: 'envoy: goods to ask for, name -> units' },
    floor: { type: 'number', description: 'envoy: least fraction of the ask to accept, 0 to 1' },
    transfer: { type: 'string', description: 'envoy: a recipe to teach them, by name' },
    threat: { type: 'boolean', description: 'envoy: demand as tribute' },
    message: { type: 'string', description: 'envoy: words for their chief' },
    roadSite: { type: 'integer', description: 'road: site number from the list' },
  },
  required: ['task', 'workers'],
} as const;

export const DECISION_SCHEMA = {
  type: 'object',
  properties: {
    orders: { type: 'array', items: ORDER_SCHEMA },
    journal: { type: 'string', description: '2 to 5 sentences in your own voice: what you saw, what you decided, why' },
    memoryNotes: { type: 'array', items: { type: 'string' }, description: 'up to 12 short notes to your future self; replaces the old notes' },
    replyToSpirit: { type: 'string', description: 'a prayer or answer to the spirit, if you have one' },
    verdicts: { type: 'array', items: { type: 'object', properties: { claim: { type: 'integer' }, verdict: { type: 'string', enum: ['fulfilled', 'failed', 'unverifiable'] } }, required: ['claim', 'verdict'] }, description: 'your judgement on any spirit claims now due' },
  },
  required: ['orders', 'journal', 'memoryNotes'],
} as const;

export const HOST_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', enum: ['accept', 'counter', 'refuse'] },
    give: { type: 'object', additionalProperties: { type: 'integer' }, description: 'counter: goods to give, name -> units' },
    take: { type: 'object', additionalProperties: { type: 'integer' }, description: 'counter: goods to take from their offer, name -> units' },
    reason: { type: 'string' },
    journal: { type: 'string' },
  },
  required: ['answer', 'journal'],
} as const;

export interface ChiefDecisionJson {
  orders: Array<{ task: string; workers: number; commodity?: string; weeks?: number; recipe?: string; quantity?: number; ingredients?: string[]; plots?: number; crop?: string; direction?: string; days?: number; site?: number; share?: number; village?: string; offer?: Record<string, number>; want?: Record<string, number>; floor?: number; transfer?: string; threat?: boolean; message?: string; roadSite?: number }>;
  journal: string; memoryNotes: string[]; replyToSpirit?: string; verdicts?: { claim: number; verdict: 'fulfilled' | 'failed' | 'unverifiable' }[];
}
export interface HostDecisionJson { answer: 'accept' | 'counter' | 'refuse'; give?: Record<string, number>; take?: Record<string, number>; reason?: string; journal: string; }
