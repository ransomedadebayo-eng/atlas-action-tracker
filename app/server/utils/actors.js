const ACTOR_PATTERN = /^[a-z0-9_-]{2,50}$/i;

export function getActor(req, fallback = 'user') {
  const actor = req.headers['x-atlas-actor'];
  if (typeof actor === 'string' && ACTOR_PATTERN.test(actor)) {
    return actor;
  }
  return fallback;
}
