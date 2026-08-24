import type {
  ActivateResponse,
  BalanceResponse,
  SolveRequest,
  SolveResponse,
} from "@grokbot/shared";

async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export async function apiActivate(
  backendUrl: string,
  activationCode: string,
  deviceLabel?: string,
): Promise<ActivateResponse> {
  return postJson<ActivateResponse>(`${backendUrl}/v1/activate`, {
    activationCode,
    ...(deviceLabel ? { deviceLabel } : {}),
  });
}

export async function apiSolve(
  backendUrl: string,
  deviceToken: string,
  request: SolveRequest,
): Promise<SolveResponse> {
  return postJson<SolveResponse>(`${backendUrl}/v1/solve`, request, {
    authorization: `Bearer ${deviceToken}`,
  });
}

export async function apiBalance(
  backendUrl: string,
  deviceToken: string,
): Promise<BalanceResponse> {
  const res = await fetch(`${backendUrl}/v1/balance`, {
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  return (await res.json()) as BalanceResponse;
}
