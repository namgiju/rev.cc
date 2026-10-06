import {Suspense} from 'react';
import PartsList from '../../components/parts/parts-list';

export const metadata = {title: '부품장터 | REV.CC'};

export default function Page() {
  return (
    <Suspense>
      <PartsList />
    </Suspense>
  );
}
