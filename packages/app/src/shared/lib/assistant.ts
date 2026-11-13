/** Opens Lefi AI's chat panel from anywhere in the app (e.g. the Dashboard's "Ask Lefi"). */
export const OPEN_ASSISTANT_EVENT = 'lefi:open-assistant';

export const openAssistant = () => window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT));

/** Goes to an app route (hash history), e.g. `/devices`. */
export const goTo = (path: string) => {
  window.location.hash = `#${path}`;
};
