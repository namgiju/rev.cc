import {Suspense} from 'react';
import {notFound} from 'next/navigation';
import ListingEditor from '../../../../components/parts/listing-editor';

export const metadata = {title: '판매글 수정'};

export default async function Page({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^\d+$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) notFound();
  return (
    <Suspense>
      <ListingEditor key={id} listingId={Number(id)} />
    </Suspense>
  );
}
