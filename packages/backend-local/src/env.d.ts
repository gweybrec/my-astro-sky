// The only ambient globals this package may use (it runs in the phone's WebView, but declares no
// DOM typings, like core).
declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(id: number | undefined): void;
