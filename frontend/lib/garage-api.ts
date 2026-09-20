export type SessionUser = {id: number; username: string};
export type VehicleInput = {
  manufacturer: string;
  model: string;
  modelYear: number;
  trim: string;
  transmission: string;
  color: string;
  nickname: string;
  description: string;
};
export type GarageVehicle = VehicleInput & {
  id: number;
  userId: number;
  username: string;
  createdAt: string;
  updatedAt: string;
};
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function garageApi<T>(path: string, options: {method?: string; body?: unknown} = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method || 'GET', credentials: 'same-origin', cache: 'no-store',
    ...(options.body === undefined ? {} : {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(options.body)}),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const fallback = response.status === 401 ? '로그인이 필요합니다.' : response.status === 403
      ? '본인 차량만 변경할 수 있습니다.' : response.status === 404 ? '차량을 찾을 수 없습니다.' : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
    throw new ApiError(data?.message || fallback, response.status);
  }
  return data as T;
}
export const vehicleName = (vehicle: GarageVehicle) => vehicle.nickname || `${vehicle.manufacturer} ${vehicle.model}`.trim();
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '연결을 확인하고 다시 시도해주세요.';
