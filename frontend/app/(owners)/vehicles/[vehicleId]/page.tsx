import {notFound} from 'next/navigation';
import VehicleProfile from '../../../../components/garage/vehicle-profile';
export const metadata = {title:'차량 프로필 | REV.CC'};
export default async function Page({params}: {params: Promise<{vehicleId:string}>}) {
  const {vehicleId} = await params;
  if (!/^\d+$/.test(vehicleId) || Number(vehicleId) < 1 || Number(vehicleId) > 2147483647) notFound();
  return <VehicleProfile vehicleId={Number(vehicleId)} />;
}
