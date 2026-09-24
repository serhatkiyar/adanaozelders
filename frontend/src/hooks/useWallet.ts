import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { downloadWalletCsv, fetchWallet, requestWithdrawal } from "@/api/wallet";

const KEY = ["wallet"] as const;

export function useWallet(enabled = true) {
  return useQuery({ queryKey: KEY, queryFn: fetchWallet, enabled });
}

export function useRequestWithdrawal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: requestWithdrawal,
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      qc.invalidateQueries({ queryKey: ["payments"] });
    },
  });
}

/** CSV'yi indirir (`useDownloadMyData` deseni). */
export function useDownloadWalletCsv() {
  return useMutation({
    mutationFn: async () => {
      const blob = await downloadWalletCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cuzdan-gecmisi-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    },
  });
}
