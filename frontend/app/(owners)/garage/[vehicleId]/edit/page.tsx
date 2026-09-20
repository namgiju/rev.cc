import {notFound} from 'next/navigation';
import VehicleEditor from '../../../../../components/garage/vehicle-form';
export const metadata = {title:'차량 수정 | REV.CC'};
export default async function Page({params}: {params: Promise<{vehicleId:string}>}) {
  const {vehicleId} = await params;
  if (!/^\d+$/.test(vehicleId) || Number(vehicleId) < 1 || Number(vehicleId) > 2147483647) notFound();
  return <VehicleEditor vehicleId={Number(vehicleId)} />;
}
