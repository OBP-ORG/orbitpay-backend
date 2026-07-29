import { rpc } from '@stellar/stellar-sdk';
type T = rpc.Api.GetEventsRequest;
type P = T['pagination'];
type R = rpc.Api.GetEventsResponse;
type C = R['cursor'];
