// What the status page knows about the visitor's email subscription, shared by the subscribe dialog
// and the subscribe buttons on each monitor. The dialog fills it from the subscription API.

export const SUBSCRIBER_TOKEN_KEY = "subscriber_token";

export const subscriber = $state({
  /** The monitors the signed-in subscriber follows; empty when signed out. */
  monitorTags: [] as string[],
});

type OpenHandler = (tag: string | null) => void;
let openHandler: OpenHandler | null = null;

/** Lets the page's subscribe dialog be opened from elsewhere. Returns the function that undoes it. */
export function RegisterSubscribeDialog(handler: OpenHandler): () => void {
  openHandler = handler;
  return () => {
    if (openHandler === handler) openHandler = null;
  };
}

/** Opens the page's subscribe dialog, with `tag`'s monitor selected when given. */
export function RequestSubscribe(tag: string | null = null): void {
  openHandler?.(tag);
}

export function ReadSubscriberToken(): string | null {
  try {
    return localStorage.getItem(SUBSCRIBER_TOKEN_KEY);
  } catch {
    return null;
  }
}
