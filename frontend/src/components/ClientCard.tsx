import { Link } from "react-router-dom";
import { Avatar } from "@/components/Avatar";
import { formatLastSeen } from "@/lib/datetime";
import { ageFromBirthDate, GENDER_LABEL } from "@/lib/demographics";
import { Gender, type ClientSearchOut } from "@/types";
import { ROUTES } from "@/lib/routes";

export function ClientCard({ client }: { client: ClientSearchOut }) {
  const age = ageFromBirthDate(client.birth_date);
  const genderLabel =
    client.gender && client.gender !== Gender.UNSPECIFIED
      ? GENDER_LABEL[client.gender]
      : null;
  const isOnline =
    !!client.last_seen_at &&
    Date.now() - new Date(client.last_seen_at).getTime() < 120_000;

  return (
    <Link
      to={ROUTES.studentProfile(client.id)}
      className="group flex h-full flex-col rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 transition duration-200 hover:-translate-y-1 hover:shadow-lg hover:ring-indigo-200 "
    >
      <div className="flex items-start gap-3">
        <Avatar name={client.full_name} avatar_url={client.avatar_url} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-slate-900 transition group-hover:text-indigo-700 ">
            {client.full_name}
          </h3>
          <p className="mt-0.5 truncate text-sm text-slate-500 ">
            @{client.username}
          </p>
        </div>
      </div>

      {client.about && (
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-slate-600 ">
          {client.about}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3 ">
        <div className="flex flex-wrap gap-1.5">
          {age !== null && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ">
              {age} yaş
            </span>
          )}
          {genderLabel && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ">
              {genderLabel}
            </span>
          )}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-slate-400 ">
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              isOnline ? "bg-emerald-400" : "bg-slate-300 "
            }`}
          />
          {isOnline ? "Çevrimiçi" : formatLastSeen(client.last_seen_at)}
        </span>
      </div>
    </Link>
  );
}

