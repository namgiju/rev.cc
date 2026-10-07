import {notFound} from 'next/navigation';
import ListingDetail from '../../../components/parts/listing-detail';

export const metadata = {title: '부품장터'};

// Canonical listing URL /parts/{id} (legacy: /parts#listing-{id}, redirected
// by the list page). Same id bounds as board-service's positive() check.
export default async function Page({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) notFound();
  return <ListingDetail key={id} listingId={Number(id)} />;
}
