// firebase@12's package.json "exports" map for "firebase/auth" has no
// "react-native" condition, so tsc/VSCode can't see getReactNativePersistence
// even though it ships in @firebase/auth and Metro resolves it fine at runtime.
import 'firebase/auth';

declare module 'firebase/auth' {
  interface ReactNativeAsyncStorage {
    setItem(key: string, value: string): Promise<void>;
    getItem(key: string): Promise<string | null>;
    removeItem(key: string): Promise<void>;
  }

  export function getReactNativePersistence(
    storage: ReactNativeAsyncStorage
  ): import('firebase/auth').Persistence;
}
