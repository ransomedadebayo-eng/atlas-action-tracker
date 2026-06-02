const ACTOR_PATTERN = /^[a-z0-9_-]{2,50}$/i;

export function getActor(req, fallback = 'user') {
  const actor = req.atlasActor;
  if (typeof actor === 'string' && ACTOR_PATTERN.test(actor)) {
    return actor;
  }
  return fallback;
}
