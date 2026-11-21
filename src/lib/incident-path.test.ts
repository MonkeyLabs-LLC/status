import {expect,it} from 'vitest';
import {decodeIncidentID} from './incident-path';
it.each(['opaque/owner/123','literal%2Fvalue','spaces and ?query#fragment','unicode-ø'])('round trips one opaque incident URL component: %s',id=>{
 expect(decodeIncidentID(encodeURIComponent(id))).toBe(id);
});
it('rejects malformed URI escapes without interpreting a second route',()=>{
 expect(()=>decodeIncidentID('%broken')).toThrow(URIError);
});
