'use client';

import {useCallback, useEffect, useState} from 'react';
import {usePathname} from 'next/navigation';
import {fetchMember, fetchMyGarageVehicles, setRepresentativeVehicle} from '../../lib/community-api';
import type {CommunityMember, OwnerVehicle} from '../../lib/community-types';
import {carUrl, imageUrl} from '../../lib/format';
import BadgeList from '../community/badge-list';
import CommunityHeader from '../community/community-header';
import {useNotice} from '../community/community-page';
import Guestbook from '../community/guestbook';
import SiteFooter from '../footer/site-footer';
import {useCommunitySession} from '../community/use-community-session';
import ProfileEditDialog from './profile-edit-dialog';
import VehicleManageDialog from './vehicle-manage-dialog';
import VehicleRegistrationDialog from './vehicle-registration-dialog';
import WithdrawDialog from './withdraw-dialog';
import styles from './my-garage.module.css';

type GarageState =
  | {status: 'loading'}
  | {status: 'error'}
  | {status: 'ready'; vehicles: OwnerVehicle[]; member: CommunityMember};

// /home, the personal garage (formerly assignment-frontend/home/index.html +
// js/home.js): page shell, representative/owned vehicle cards, registration,
// editing/records, profile settings, guestbook and withdrawal (STEP 3-1~3-5
// — see REVCC_NEXT_TASKS.md). Vehicle detail is not re-built here: the cards
// link to the public vehicle page from STEP 2-5 (/community/cars/:id).
export default function MyGarage() {
  const auth = useCommunitySession();
  const {session} = auth;
  const pathname = usePathname();
  const {notice, notify} = useNotice();
  const [state, setState] = useState<GarageState>({status: 'loading'});
  const [reloadKey, setReloadKey] = useState(0);
  const [repBusyId, setRepBusyId] = useState<number | null>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [manageVehicleId, setManageVehicleId] = useState<number | null>(null);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const load = useCallback(() => {
    if (!session) return;
    setState({status: 'loading'});
    Promise.all([fetchMyGarageVehicles(), fetchMember(session.id)])
      .then(([vehicles, member]) => setState({status: 'ready', vehicles, member}))
      .catch(() => setState({status: 'error'}));
  }, [session]);

  useEffect(() => {
    if (session) load();
  }, [session, reloadKey, load]);

  async function chooseRepresentative(vehicleId: number) {
    setRepBusyId(vehicleId);
    try {
      await setRepresentativeVehicle(vehicleId);
      setReloadKey((k) => k + 1);
    } catch (error) {
      notify(error instanceof Error ? error.message : '대표 차량을 설정하지 못했어요.');
    } finally {
      setRepBusyId(null);
    }
  }

  const requireLogin = useCallback(() => {
    if (session) return true;
    notify('로그인 후 이용할 수 있어요. 상단의 로그인 / 가입을 눌러주세요.');
    return false;
  }, [session, notify]);

  return (
    <div className={styles.shell}>
      <CommunityHeader
        auth={auth}
        search=""
        onSearchChange={() => {}}
        onSearchSubmit={(value) => {
          window.location.href = value ? `/community?q=${encodeURIComponent(value)}` : '/community';
        }}
        loginNext={encodeURIComponent(pathname)}
      />
      <main className={styles.main}>
        <div className={styles.heading}>
          <div>
            <h1>내 차고</h1>
            <p>나의 자동차 생활을 기록하는 공간, REV.CC</p>
          </div>
        </div>
        <p className={styles.notice} role="status" aria-live="polite">
          {notice}
        </p>
        {session === undefined && <p className={styles.empty}>로그인 상태를 확인하고 있어요.</p>}
        {session === null && (
          <div className={styles.loginRequired}>
            <p>내 차고를 이용하려면 로그인이 필요합니다.</p>
            <a href={`/login?next=${encodeURIComponent(pathname)}`}>로그인하기</a>
          </div>
        )}
        {session && state.status === 'loading' && <p className={styles.empty}>차고 정보를 불러오고 있어요.</p>}
        {session && state.status === 'error' && (
          <p className={styles.empty}>
            차고 정보를 불러오지 못했어요.{' '}
            <button type="button" className={styles.retry} onClick={() => setReloadKey((k) => k + 1)}>
              다시 시도
            </button>
          </p>
        )}
        {session && state.status === 'ready' && (
          <>
            <section className={styles.panel} aria-labelledby="profile-title">
              <div className={styles.panelHeadingRow}>
                <h2 id="profile-title">내 프로필</h2>
                <div>
                  <button type="button" className={styles.registerButton} onClick={() => setProfileEditOpen(true)}>
                    프로필 편집
                  </button>{' '}
                  <button type="button" className={styles.dangerText} onClick={() => setWithdrawOpen(true)}>
                    회원 탈퇴
                  </button>
                </div>
              </div>
              {state.member.coverImageId && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.coverPhoto} src={imageUrl(state.member.coverImageId)} alt="프로필 커버" />
              )}
              <div className={styles.profileRow}>
                {state.member.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.avatar} src={state.member.avatarUrl} alt={state.member.username} />
                ) : (
                  <div className={styles.avatar} aria-hidden="true">
                    {[...state.member.username][0] || ''}
                  </div>
                )}
                <div>
                  <strong>{state.member.username}</strong>
                  {state.member.bio && <p className={styles.empty}>{state.member.bio}</p>}
                </div>
              </div>
              <BadgeList badges={state.member.badges} empty="아직 획득한 인장이 없습니다. 차량 인증을 완료하면 오너 인장이 표시됩니다." compact />
            </section>
            <div className={styles.grid}>
            <section className={styles.panel} aria-labelledby="garage-title">
              <h2 id="garage-title">대표 차량</h2>
              <RepresentativeVehicle vehicles={state.vehicles} member={state.member} onManage={setManageVehicleId} />
            </section>
            <aside className={styles.panel} aria-labelledby="owned-title">
              <div className={styles.panelHeadingRow}>
                <h2 id="owned-title">보유 차량</h2>
                <button type="button" className={styles.registerButton} onClick={() => setRegistrationOpen(true)}>
                  차량 등록
                </button>
              </div>
              <OwnedVehicleList
                vehicles={state.vehicles}
                member={state.member}
                busyId={repBusyId}
                onChooseRepresentative={chooseRepresentative}
                onManage={setManageVehicleId}
              />
            </aside>
            </div>
            <Guestbook ownerId={state.member.id} viewer={session ?? null} requireLogin={requireLogin} notify={notify} />
          </>
        )}
      </main>
      {registrationOpen && (
        <VehicleRegistrationDialog
          onClose={() => setRegistrationOpen(false)}
          onVehicleCreated={() => setReloadKey((k) => k + 1)}
          notify={notify}
        />
      )}
      {manageVehicleId !== null && (
        <VehicleManageDialog
          vehicleId={manageVehicleId}
          onClose={() => setManageVehicleId(null)}
          onChanged={() => setReloadKey((k) => k + 1)}
        />
      )}
      {profileEditOpen && state.status === 'ready' && (
        <ProfileEditDialog
          member={state.member}
          onClose={() => setProfileEditOpen(false)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      )}
      {withdrawOpen && <WithdrawDialog onClose={() => setWithdrawOpen(false)} />}
      <SiteFooter />
    </div>
  );
}

const VERIFICATION_CHIP: Record<string, [string, string]> = {
  PENDING: ['인증 검토 중', styles.chipPending],
  REJECTED: ['인증 반려', styles.chipBlocked],
};

function verificationChip(vehicle: OwnerVehicle): [string, string] {
  if (vehicle.verified) return ['인증 완료', styles.chipOk];
  return VERIFICATION_CHIP[vehicle.verificationStatus ?? ''] ?? ['인증 전', styles.chipPending];
}

function RepresentativeVehicle({
  vehicles,
  member,
  onManage,
}: {
  vehicles: OwnerVehicle[];
  member: CommunityMember;
  onManage: (vehicleId: number) => void;
}) {
  if (!vehicles.length) {
    return (
      <p className={styles.empty}>
        아직 등록된 차량이 없습니다.
        <br />
        차량을 등록하면 이곳에 대표 차량이 표시됩니다.
      </p>
    );
  }
  const repId = member.representativeVehicle?.id ?? vehicles[0].id;
  const vehicle = vehicles.find((v) => v.id === repId) ?? vehicles[0];
  const imageId = member.vehicles.find((v) => v.id === vehicle.id)?.imageId ?? null;
  const [label, chipClass] = verificationChip(vehicle);
  return (
    <div className={styles.repCard}>
      {imageId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.repPhoto} src={imageUrl(imageId)} alt={vehicle.model} />
      ) : (
        <div className={styles.repPhotoPlaceholder} aria-hidden="true">
          🚗
        </div>
      )}
      <div className={styles.repInfo}>
        <p className={styles.eyebrow}>{vehicle.manufacturer}</p>
        <h3>{vehicle.nickname || vehicle.model}</h3>
        <p className={styles.empty}>{[vehicle.modelYear, vehicle.trim].filter(Boolean).join(' · ')}</p>
        <span className={`${styles.chip} ${chipClass}`}>{label}</span>
        {vehicle.description && <p>{vehicle.description}</p>}
        <a className={styles.detailLink} href={carUrl(vehicle.id)}>
          차량 상세 보기 →
        </a>
        <button type="button" className={styles.repButton} onClick={() => onManage(vehicle.id)}>
          수정
        </button>
      </div>
    </div>
  );
}

function OwnedVehicleList({
  vehicles,
  member,
  busyId,
  onChooseRepresentative,
  onManage,
}: {
  vehicles: OwnerVehicle[];
  member: CommunityMember;
  busyId: number | null;
  onChooseRepresentative: (vehicleId: number) => void;
  onManage: (vehicleId: number) => void;
}) {
  if (!vehicles.length) return <p className={styles.empty}>등록된 차량이 없습니다.</p>;
  const repId = member.representativeVehicle?.id ?? vehicles[0].id;
  return (
    <div className={styles.vehicleList}>
      {vehicles.map((vehicle) => {
        const imageId = member.vehicles.find((v) => v.id === vehicle.id)?.imageId ?? null;
        const selected = vehicle.id === repId;
        return (
          <div key={vehicle.id} className={styles.vehicleRow}>
            <a href={carUrl(vehicle.id)}>
              {imageId ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.vehiclePhoto} src={imageUrl(imageId)} alt={vehicle.model} />
              ) : (
                <div className={styles.vehiclePhotoPlaceholder} aria-hidden="true" />
              )}
            </a>
            <a className={styles.vehicleRowInfo} href={carUrl(vehicle.id)}>
              <strong>{vehicle.nickname || vehicle.model}</strong>
              <span>{[vehicle.modelYear, vehicle.trim].filter(Boolean).join(' · ')}</span>
            </a>
            <button
              type="button"
              className={styles.repButton}
              disabled={selected || busyId === vehicle.id}
              onClick={() => onChooseRepresentative(vehicle.id)}
            >
              {selected ? '대표 차량' : busyId === vehicle.id ? '설정 중…' : '대표 차량 설정'}
            </button>
            <button type="button" className={styles.repButton} onClick={() => onManage(vehicle.id)}>
              수정
            </button>
          </div>
        );
      })}
    </div>
  );
}
