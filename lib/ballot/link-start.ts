/** A click before React starts must carry the choice, even while the place is unresolved. */
export const BALLOT_LINK_START_SCRIPT = `document.addEventListener("click",event=>{
const link=event.target?.closest?.("a[data-ballot-link]");
if(!link||event.defaultPrevented)return;
const target=new URL(link.href,location.href);
if(target.origin!==location.origin||target.pathname!=="/ballot"||target.searchParams.has("zip"))return;
let zip=new URLSearchParams(location.search).get("zip");
if(zip===null){try{zip=JSON.parse(localStorage.getItem("wtp.approximate_location")||"null")?.zip}catch{}}
if(typeof zip!=="string"||!/^\\d{5}$/.test(zip))return;
target.searchParams.set("zip",zip);link.href=target.href;
if(event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){
event.preventDefault();event.stopImmediatePropagation();location.assign(target.href);
}
},true);`;
