let glossaryPromise = null;

/**
 * Fetch the client-facing tooltip glossary once per page load. The promise is
 * cached, so every component shares a single request; a failure is cached
 * too, so callers see the same consistent outcome instead of refetching.
 * Callers decide how to degrade when the glossary is unavailable.
 */
export const getGlossary = () => {
  if (!glossaryPromise) {
    glossaryPromise = fetch("/glossary/").then(async (response) => {
      if (!response.ok) throw new Error(`GET /glossary/ failed: ${response.status}`);
      return response.json();
    });
  }
  return glossaryPromise;
};
