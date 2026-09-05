import type { PermissionPolicySet } from "@xmtp/browser-sdk";

type Hex = `0x${string}`;
type Address = `0x${string}`;

type AnyFn = (...args: unknown[]) => unknown;
type ClassProperties<C> = {
  [K in keyof C as C[K] extends AnyFn ? never : K]: C[K];
};

export type PolicySet = ClassProperties<PermissionPolicySet>;

export interface TransactionReferenceMessage {
  content: {
    transactionReference: {
      networkId: Hex;
      reference: Hex; // transaction hash
      metadata: {
        transactionType: string;
        fromAddress: Address;
      };
    };
  };
}
