import {schema,table,t,SenderError} from 'spacetimedb/server';
const settings=table({name:'settings'},{key:t.string().primaryKey(),identity:t.identity()});
const care_item=table({name:'care_item'},{
 id:t.string().primaryKey(),name:t.string(),price_cents:t.i32(),currency:t.string(),reason:t.string(),buy_url:t.string(),price_status:t.string(),provider:t.string(),product_name:t.string(),recommended:t.bool(),guidance:t.string(),updated_at:t.string(),price_checked_at:t.string()
});
const spacetimedb=schema({settings,care_item});
export default spacetimedb;
export const init=spacetimedb.init(ctx=>{ctx.db.settings.insert({key:'owner',identity:ctx.sender})});
export const upsert_item=spacetimedb.reducer({id:t.string(),name:t.string(),price_cents:t.i32(),currency:t.string(),reason:t.string(),buy_url:t.string(),price_status:t.string(),provider:t.string(),product_name:t.string(),recommended:t.bool(),guidance:t.string(),updated_at:t.string(),price_checked_at:t.string()},(ctx,row)=>{
 const owner=ctx.db.settings.key.find('owner');
 if(!owner||!owner.identity.isEqual(ctx.sender))throw new SenderError('Only the BAYMAX backend may write care items');
 if(!row.id||row.id.length>80||row.name.length>200||row.reason.length>1500||row.guidance.length>1800||row.buy_url.length>2000||row.price_cents < -1||row.price_cents>10000000)throw new SenderError('Invalid care item');
 if(row.buy_url&&!/^https:\/\/(www\.)?(amazon\.com|walmart\.com|target\.com)\//.test(row.buy_url))throw new SenderError('Unsupported retailer URL');
 const existing=ctx.db.care_item.id.find(row.id);
 if(!existing)ctx.db.care_item.insert(row); // Idempotent catalog seeding never overwrites a recommendation.
});
export const set_recommendation=spacetimedb.reducer({id:t.string(),reason:t.string(),updated_at:t.string()},(ctx,args)=>{
 const owner=ctx.db.settings.key.find('owner');
 if(!owner||!owner.identity.isEqual(ctx.sender))throw new SenderError('Backend identity required');
 const row=ctx.db.care_item.id.find(args.id);
 if(!row||args.reason.length>1500)throw new SenderError('Invalid recommendation');
 ctx.db.care_item.id.update({...row,reason:args.reason,recommended:true,updated_at:args.updated_at});
});
export const set_offer=spacetimedb.reducer({id:t.string(),price_cents:t.i32(),currency:t.string(),buy_url:t.string(),price_status:t.string(),provider:t.string(),product_name:t.string(),price_checked_at:t.string()},(ctx,args)=>{
 const owner=ctx.db.settings.key.find('owner');
 if(!owner||!owner.identity.isEqual(ctx.sender))throw new SenderError('Backend identity required');
 const row=ctx.db.care_item.id.find(args.id);
 if(!row)throw new SenderError('Unknown care item');
 if(args.price_status==='lookup_failed'){ctx.db.care_item.id.update({...row,price_status:'lookup_failed'});return}
 if(args.price_status!=='live_quote'||args.price_cents<0||args.price_cents>10000000||args.currency!=='USD'||!/^https:\/\/www\.amazon\.com\/dp\/[A-Z0-9]{10}$/.test(args.buy_url)||args.product_name.length>300)throw new SenderError('Invalid product quote');
 ctx.db.care_item.id.update({...row,...args});
});

// Public account identity, not a secret. Enables a safe first migration of this existing empty cloud DB.
const CLOUD_MIGRATION_OWNER='c200aed125e3eead4e149fd80de1b65a61bbf29840b8aeaf64021204c757063e';
export const initialize_cloud_owner=spacetimedb.reducer(ctx=>{
 if(ctx.db.settings.key.find('owner'))return;
 if(ctx.sender.toHexString()!==CLOUD_MIGRATION_OWNER)throw new SenderError('The configured cloud publisher must initialize this database');
 ctx.db.settings.insert({key:'owner',identity:ctx.sender});
});
export const add_manual_item=spacetimedb.reducer({id:t.string(),name:t.string(),price_cents:t.i32(),currency:t.string(),reason:t.string(),buy_url:t.string(),price_status:t.string(),provider:t.string(),product_name:t.string(),recommended:t.bool(),guidance:t.string(),updated_at:t.string(),price_checked_at:t.string()},(ctx,row)=>{
 const owner=ctx.db.settings.key.find('owner');
 if(!owner||!owner.identity.isEqual(ctx.sender))throw new SenderError('Backend identity required');
 if(!/^custom-[a-f0-9]{24}$/.test(row.id)||row.name.trim().length<2||row.name.length>160||!row.reason.trim()||row.reason.length>1500||row.price_cents < -1||row.price_cents>10000000||row.currency!=='USD'||row.recommended||row.provider!=='Added by you'||row.guidance.length>1800||row.buy_url.length>2000)throw new SenderError('Invalid manually added item');
 if(!/^https:\/\/(www\.)?(amazon\.com|walmart\.com|target\.com|cvs\.com|walgreens\.com|costco\.com)(:443)?\//.test(row.buy_url))throw new SenderError('Unsupported retailer URL');
 if(!['manual_entry','api_key_required','not_checked'].includes(row.price_status))throw new SenderError('Invalid price source');
 if(ctx.db.care_item.id.find(row.id))throw new SenderError('An item with this name already exists');
 ctx.db.care_item.insert(row);
});
