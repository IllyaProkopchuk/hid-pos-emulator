import type { Fault } from '@shared/framing';

export type FaultDefinition = {
  id: Fault;
  name: string;
  description: string;
  /** Dropping a length byte is meaningless on a profile that never sends one. */
  requiresLengthByte?: boolean;
};

export const FAULTS: Array<FaultDefinition> = [
  {
    id: 'missingLengthByte',
    name: 'Missing length byte',
    description: 'The app logs "length byte exceeds report size"',
    requiresLengthByte: true,
  },
  {
    id: 'noTerminator',
    name: 'No terminator',
    description: 'The scan never completes, the next scan carries the tail',
  },
  {
    id: 'terminatorInOwnReport',
    name: 'Terminator in its own report',
    description: 'The scan completes one report later',
  },
];
