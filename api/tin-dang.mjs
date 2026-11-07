import {createCloudListings,respond} from '../_lib/tin-dang.mjs';
export default respond(createCloudListings().owner,['GET','POST','PATCH']);
