-- Update app_config with actual TestFlight invite and Google Play links
update public.app_config set value = 'https://testflight.apple.com/v1/invite/ccaeb5a9afad46d7aec1fa7057ca65c59a00f3a93f65401fb29118bb7729de90192f1150b?ct=6VP97RYRB8&advp=10000&platform=ios'
where key = 'store_url_ios';

update public.app_config set value = 'https://play.google.com/store/apps/details?id=com.miba.app&hl=en-US&ah=xXOC0Ve-QJCTqCzMnHymCL1ZBbk'
where key = 'store_url_android';
