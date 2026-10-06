import {notFound} from 'next/navigation';
import VehiclePublic from '../../../../components/community/vehicle-public';

export const metadata = {title: '차량'};

// Formerly the legacy /community#car-{id} dialog. A static segment wins
// over /community/[category]/[id], so this never collides with post URLs.
export default async function Page({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) notFound();
  return <VehiclePublic key={id} vehicleId={Number(id)} />;
}
