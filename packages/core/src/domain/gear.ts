// Gear-setup API shapes.

export interface GearSetupData {
  id: string;
  name: string;
  telescopeId: string;
  cameraId: string;
  accessoryId: string | null;
  enabled: boolean;
}
