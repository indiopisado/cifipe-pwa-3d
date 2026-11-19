if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register(new URL('./service-worker.js',document.baseURI), {scope:'./'}).catch(()=>{});
}

let installPrompt;
let installButton;
window.addEventListener('beforeinstallprompt', event=>{
  event.preventDefault();
  installPrompt=event;
  if(!installButton){
    installButton=document.createElement('button');
    installButton.type='button'; installButton.className='action'; installButton.textContent='Instalar PWA';
    installButton.addEventListener('click',async()=>{
      if(!installPrompt)return;
      await installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt=null; installButton.hidden=true;
    });
    document.querySelector('.header-actions')?.prepend(installButton);
  }
  installButton.hidden=false;
});
window.addEventListener('appinstalled',()=>{installPrompt=null;if(installButton)installButton.hidden=true;});
