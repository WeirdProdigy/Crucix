import { XMLParser, XMLValidator } from 'fast-xml-parser';
function decode(value) {
  if (typeof value === 'string') return value.replace(/&(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g, token => {
    const known = { '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'" };
    if (known[token]) return known[token];
    const point = token.startsWith('&#x') ? parseInt(token.slice(3,-1),16) : Number(token.slice(2,-1));
    return point>0 && point<=0x10ffff && !(point>=0xd800 && point<=0xdfff) ? String.fromCodePoint(point) : '';
  });
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') for (const key of Object.keys(value)) value[key] = decode(value[key]);
  return value;
}
export function parseXml(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml)>2*1024*1024 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('Unsafe or oversized XML');
  if (XMLValidator.validate(xml)!==true) throw new Error('Invalid XML');
  const parser = new XMLParser({ ignoreAttributes:false, removeNSPrefix:true, parseTagValue:false,
    processEntities:false, maxNestedTags:50, onDangerousProperty:()=>{ throw new Error('Unsafe XML property'); } });
  return decode(parser.parse(xml));
}
