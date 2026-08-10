/**
 * Thin wrapper around Google's Picker API — the folder-chooser dialog used by the Google Drive
 * sync settings.
 *
 * Why a picker at all: the OAuth scope this feature requests is `drive.file`, which is a *per-file*
 * grant. It deliberately does not allow listing the user's Drive, so Immich cannot render its own
 * folder tree — we'd have nothing to populate it with. The Picker is Google's sanctioned way out of
 * that: it runs inside Google's own origin, so it can show the user their real folder structure,
 * and picking a folder there is what extends our `drive.file` grant to cover that folder. Before
 * this, the only option was pasting a folder id copied out of a Drive URL.
 *
 * Everything here is loaded lazily, on the first click of "choose a folder". Google's api.js is
 * ~100KB and completely useless to the vast majority of page loads, so pulling it in as a normal
 * import would tax everyone for a feature almost nobody opens.
 */

/**
 * Minimal shape of the bits of `window.google.picker` we actually touch.
 *
 * Google ships no types for this (`@types/google.picker` exists but is a third-party package, and
 * pulling in a dependency to describe six method calls isn't worth it). These are hand-written from
 * the published API surface, so they're intentionally narrow: only the builder methods used below
 * appear, which means a typo in a method name is still a compile error rather than an `any` hole.
 */
type PickerDocument = { id: string; name?: string };
type PickerResponse = { action: string; docs?: PickerDocument[] };

type PickerView = {
  setIncludeFolders: (include: boolean) => PickerView;
  setSelectFolderEnabled: (enabled: boolean) => PickerView;
  setMimeTypes: (mimeTypes: string) => PickerView;
};

type PickerBuilder = {
  addView: (view: PickerView) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (appId: string) => PickerBuilder;
  setTitle: (title: string) => PickerBuilder;
  setCallback: (callback: (data: PickerResponse) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};

type GooglePicker = {
  DocsView: new (viewId: string) => PickerView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { FOLDERS: string };
  Action: { PICKED: string; CANCEL: string };
};

type GoogleApiLoader = {
  load: (name: string, options: { callback: () => void; onerror?: () => void }) => void;
};

/**
 * `gapi` and `google` are injected as globals by Google's scripts, so they simply don't exist until
 * those scripts have run. Rather than `declare`-ing them (which would tell the compiler they're
 * always there and hide exactly the case this module has to handle), they're read through a cast
 * that makes both optional — so every access has to cope with "not loaded yet".
 */
type GoogleGlobals = {
  gapi?: GoogleApiLoader;
  google?: { picker?: GooglePicker };
};

const googleGlobals = () => globalThis as unknown as GoogleGlobals;

const GOOGLE_API_SCRIPT = 'https://apis.google.com/js/api.js';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

/**
 * Injects Google's api.js once and resolves when it's ready.
 *
 * The promise is cached rather than the boolean "did we load it" flag, so two rapid clicks await
 * the *same* load instead of racing to append two `<script>` tags. A failed load clears the cache,
 * which lets a later retry actually retry rather than replaying the original rejection forever.
 */
let apiScriptPromise: Promise<void> | undefined;

const loadGoogleApiScript = (): Promise<void> => {
  if (googleGlobals().gapi) {
    return Promise.resolve();
  }

  apiScriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GOOGLE_API_SCRIPT;
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Failed to load the Google Picker script')));
    document.head.append(script);
  }).catch((error: unknown) => {
    apiScriptPromise = undefined;
    throw error;
  });

  return apiScriptPromise;
};

/**
 * Loads the 'picker' module inside the already-loaded api.js. Separate step: api.js is only a
 * loader, and `google.picker` doesn't exist until this resolves.
 */
const loadPickerModule = (): Promise<GooglePicker> =>
  new Promise((resolve, reject) => {
    const { gapi } = googleGlobals();
    if (!gapi) {
      reject(new Error('The Google API script loaded but did not initialise'));
      return;
    }

    gapi.load('picker', {
      callback: () => {
        const picker = googleGlobals().google?.picker;
        if (picker) {
          resolve(picker);
        } else {
          reject(new Error('The Google Picker module loaded but is unavailable'));
        }
      },
      onerror: () => reject(new Error('Failed to load the Google Picker module')),
    });
  });

/**
 * Derives the Google Cloud *project number* from an OAuth client id.
 *
 * The Picker wants this as its "app id", and a client id is formatted
 * `<project number>-<random>.apps.googleusercontent.com` — so the number is already in the data we
 * have, and asking an admin to look up and enter it separately would be a third credential field
 * for no gain. Returns undefined for anything not in that shape, in which case `setAppId` is simply
 * skipped: it is an optional hint, and the picker works without it.
 */
const getAppId = (clientId: string): string | undefined => {
  const [projectNumber] = clientId.split('-');
  return /^\d+$/.test(projectNumber) ? projectNumber : undefined;
};

export type GooglePickerConfig = {
  accessToken: string;
  clientId: string;
  apiKey: string;
};

/**
 * Opens the folder picker and resolves with the chosen folder, or `undefined` if the user closed
 * the dialog without choosing one.
 *
 * Cancellation is deliberately *not* an error: "I changed my mind" is a normal outcome, and
 * modelling it as a rejection would make every caller write a try/catch that inspects the error to
 * decide whether to show a failure toast.
 *
 * @param title dialog heading, passed in already-translated — this module has no i18n of its own.
 */
export const pickGoogleDriveFolder = async (
  { accessToken, clientId, apiKey }: GooglePickerConfig,
  title: string,
): Promise<PickerDocument | undefined> => {
  await loadGoogleApiScript();
  const picker = await loadPickerModule();

  return new Promise<PickerDocument | undefined>((resolve) => {
    // FOLDERS + setSelectFolderEnabled is what makes folders themselves selectable; without it the
    // view shows folders only as navigation and the "select" button stays disabled until a *file*
    // is highlighted. Restricting mime types to folders keeps the list free of the user's files,
    // which are noise here — they can't be chosen anyway.
    const view = new picker.DocsView(picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME_TYPE);

    const builder = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .setTitle(title)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          resolve(data.docs?.[0]);
        } else if (data.action === picker.Action.CANCEL) {
          resolve(undefined);
        }
        // Any other action (notably 'loaded') is a lifecycle notification, not a result — ignore it
        // and leave the promise pending until the user actually picks or cancels.
      });

    const appId = getAppId(clientId);
    if (appId) {
      builder.setAppId(appId);
    }

    builder.build().setVisible(true);
  });
};
