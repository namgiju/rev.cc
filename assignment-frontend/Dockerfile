# 빌드 프레임워크 없이 HTML/CSS/Vanilla JS만 정적 제공한다.
FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
COPY img /usr/share/nginx/html/img
COPY home /usr/share/nginx/html/home
COPY admin /usr/share/nginx/html/admin
COPY community /usr/share/nginx/html/community
COPY garage /usr/share/nginx/html/garage
COPY parts /usr/share/nginx/html/parts
