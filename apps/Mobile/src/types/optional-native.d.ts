declare module 'livekit-client' {
  export class Room { constructor(opts?: any); [key: string]: any; }
  export const RoomEvent: Record<string, any>;
  export function createLocalAudioTrack(opts?: any): Promise<any>;
}
declare module '@livekit/react-native' {
  export function registerGlobals(): void;
  export const AudioSession: Record<string, any>;
}
declare module 'react-native-callkeep' {
  const RNCallKeep: any;
  export default RNCallKeep;
}
declare module '@react-native-firebase/messaging' {
  const firebaseMessaging: any;
  export const { getMessaging, setBackgroundMessageHandler, onMessage, getToken, requestPermission, AuthorizationStatus, getAPNSToken, deleteToken } = firebaseMessaging;
  export default firebaseMessaging;
}
declare module 'react-native-voip-push-notification' {
  const VoipPush: any;
  export default VoipPush;
}
